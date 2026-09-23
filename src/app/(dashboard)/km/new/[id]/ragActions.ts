"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import {
  buildUserContent,
  buildRagSystemPrompt,
  webFetchMaxUses,
  hasSourceUrls,
  ragDocId,
  ragSourceDescription,
} from "@/lib/kmAnalysis";
import type Anthropic from "@anthropic-ai/sdk";

export type RagActionState = { success?: string; error?: string };

export async function generateRagContentAction(sourceId: string): Promise<RagActionState> {
  const session = await requireSession();

  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "找不到這份來源。" };
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) {
    return { error: "沒有權限操作這份來源。" };
  }

  await prisma.kmSource.update({ where: { id: sourceId }, data: { ragStatus: "PROCESSING" } });

  try {
    const system = buildRagSystemPrompt({ docId: ragDocId(source), sourceDescription: ragSourceDescription(source) });
    const content = buildUserContent(source);

    const response = await anthropic.messages.create({
      model: KM_ANALYSIS_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      ...(hasSourceUrls(source)
        ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: webFetchMaxUses(source) }] }
        : {}),
      messages: [{ role: "user", content }],
    });

    await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "km_rag", usage: response.usage, roleId: source.roleId });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!text) {
      await prisma.kmSource.update({
        where: { id: sourceId },
        data: { ragStatus: "FAILED", ragErrorMessage: "沒有產出任何內容。" },
      });
      return { error: "沒有產出任何內容。" };
    }

    await prisma.kmSource.update({ where: { id: sourceId }, data: { ragContent: text, ragStatus: "DONE" } });

    revalidatePath(`/km/new/${sourceId}`);
    return { success: "RAG 內容已產生。" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    await prisma.kmSource.update({
      where: { id: sourceId },
      data: { ragStatus: "FAILED", ragErrorMessage: message },
    });
    return { error: `產出失敗：${message}` };
  }
}
