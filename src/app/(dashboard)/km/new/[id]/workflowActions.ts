"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { buildUserContent, buildWorkflowSystemPrompt, parseWorkflowDrafts, webFetchMaxUses, hasSourceUrls } from "@/lib/kmAnalysis";
import type Anthropic from "@anthropic-ai/sdk";

export type WorkflowActionState = { success?: string; error?: string };

const STOPPED_MESSAGE = "這次產生已經被停止或重新開始，結果沒有保存。";

export async function generateWorkflowDraftsAction(sourceId: string): Promise<WorkflowActionState> {
  const session = await requireSession();

  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "找不到這份來源。" };
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) {
    return { error: "沒有權限操作這份來源。" };
  }

  // 用開始時間標記「這一次」產生；寫回結果時只更新還是同一次的（中途按了停止或重新產生，就不覆蓋）。
  const startedAt = new Date();
  await prisma.kmSource.update({
    where: { id: sourceId },
    data: { workflowStatus: "PROCESSING", workflowStartedAt: startedAt, workflowErrorMessage: null },
  });
  const sameAttempt = { id: sourceId, workflowStartedAt: startedAt };

  try {
    const skills = await prisma.skill.findMany({ where: { roleId: source.roleId } });
    const system = buildWorkflowSystemPrompt(skills);
    const content = buildUserContent(source);

    const response = await anthropic.messages.create({
      model: KM_ANALYSIS_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system,
      ...(hasSourceUrls(source)
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
      const noDrafts = "沒有辨識出任何客服情境，可能是內容不足以支撐 Workflow 產出。";
      const { count } = await prisma.kmSource.updateMany({
        where: sameAttempt,
        data: { workflowStatus: "FAILED", workflowErrorMessage: noDrafts },
      });
      return { error: count ? noDrafts : STOPPED_MESSAGE };
    }

    const saved = await prisma.$transaction(async (tx) => {
      const { count } = await tx.kmSource.updateMany({ where: sameAttempt, data: { workflowStatus: "DONE" } });
      if (!count) return false;
      await tx.agentDraft.createMany({
        data: drafts.map((d) => ({
          sourceId,
          suggestedName: d.suggestedName,
          suggestedPrompt: d.suggestedPrompt,
          suggestedSkillIds: d.suggestedSkillIds,
          unmatchedNote: d.unmatchedNote,
          roleId: source.roleId,
        })),
      });
      return true;
    });
    if (!saved) return { error: STOPPED_MESSAGE };

    revalidatePath(`/km/new/${sourceId}`);
    revalidatePath("/agents/drafts");
    return { success: `已產出 ${drafts.length} 個 Agent 草稿，可以到「Workflow 草稿」頁面審核。` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    const { count } = await prisma.kmSource.updateMany({
      where: sameAttempt,
      data: { workflowStatus: "FAILED", workflowErrorMessage: message },
    });
    return { error: count ? `產出失敗：${message}` : STOPPED_MESSAGE };
  }
}

// 停止：產生過程被中斷時狀態會一直卡在「產生中」，按停止就能解除、重新產生。
export async function stopWorkflowDraftsAction(sourceId: string): Promise<WorkflowActionState> {
  const session = await requireSession();

  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "找不到這份來源。" };
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) {
    return { error: "沒有權限操作這份來源。" };
  }
  if (source.workflowStatus !== "PROCESSING") return { error: "目前沒有正在產生的 Workflow。" };

  await prisma.kmSource.update({
    where: { id: sourceId },
    data: { workflowStatus: "FAILED", workflowStartedAt: null, workflowErrorMessage: "已手動停止。" },
  });

  revalidatePath(`/km/new/${sourceId}`);
  return { success: "已停止，可以重新產生。" };
}
