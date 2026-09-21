"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { buildUserContent, buildWorkflowSystemPrompt, parseWorkflowDrafts, webFetchMaxUses } from "@/lib/kmAnalysis";
import type Anthropic from "@anthropic-ai/sdk";

export type WorkflowActionState = { success?: string; error?: string };

export async function generateWorkflowDraftsAction(sourceId: string): Promise<WorkflowActionState> {
  const session = await requireSession();

  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "找不到這份來源。" };
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) {
    return { error: "沒有權限操作這份來源。" };
  }

  await prisma.kmSource.update({ where: { id: sourceId }, data: { workflowStatus: "PROCESSING" } });

  try {
    const skills = await prisma.skill.findMany({ where: { roleId: source.roleId } });
    const system = buildWorkflowSystemPrompt(skills);
    const content = buildUserContent(source);

    const response = await anthropic.messages.create({
      model: KM_ANALYSIS_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system,
      ...(source.sourceType === "URL"
        ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: webFetchMaxUses(source) }] }
        : {}),
      messages: [{ role: "user", content }],
    });

    await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "km_workflow", usage: response.usage, roleId: source.roleId });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const drafts = parseWorkflowDrafts(text, skills);

    if (drafts.length === 0) {
      await prisma.kmSource.update({
        where: { id: sourceId },
        data: { workflowStatus: "FAILED", workflowErrorMessage: "沒有辨識出任何客服情境，可能是內容不足以支撐 Workflow 產出。" },
      });
      return { error: "沒有辨識出任何客服情境，可能是內容不足以支撐 Workflow 產出。" };
    }

    await prisma.$transaction([
      ...drafts.map((d) =>
        prisma.agentDraft.create({
          data: {
            sourceId,
            suggestedName: d.suggestedName,
            suggestedPrompt: d.suggestedPrompt,
            suggestedSkillIds: d.suggestedSkillIds,
            unmatchedNote: d.unmatchedNote,
            roleId: source.roleId,
          },
        }),
      ),
      prisma.kmSource.update({ where: { id: sourceId }, data: { workflowStatus: "DONE" } }),
    ]);

    revalidatePath(`/km/new/${sourceId}`);
    revalidatePath("/agents/drafts");
    return { success: `已產出 ${drafts.length} 個 Agent 草稿，可以到「Workflow 草稿」頁面審核。` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    await prisma.kmSource.update({
      where: { id: sourceId },
      data: { workflowStatus: "FAILED", workflowErrorMessage: message },
    });
    return { error: `產出失敗：${message}` };
  }
}
