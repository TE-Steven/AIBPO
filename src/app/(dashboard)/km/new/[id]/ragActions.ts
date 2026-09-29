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
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { companyIdForRole } from "@/lib/company";
import { getPromptConfig } from "@/lib/promptConfigStore";

export type RagActionState = { success?: string; error?: string };

const STOPPED_MESSAGE = "這次產生已經被停止或重新開始，結果沒有保存。";

export async function generateRagContentAction(sourceId: string): Promise<RagActionState> {
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
    data: { ragStatus: "PROCESSING", ragStartedAt: startedAt, ragErrorMessage: null },
  });
  const sameAttempt = { id: sourceId, ragStartedAt: startedAt };

  try {
    // 公司的「Prompt 最高準則」跟 FAQ／結構化文件一樣要套用
    const companyId = await companyIdForRole(source.roleId);
    const [guidelines, config] = await Promise.all([getSystemSetting(companyId, KM_OUTPUT_GUIDELINES_KEY), getPromptConfig(companyId)]);
    const system = buildRagSystemPrompt({
      docId: ragDocId(source),
      sourceDescription: ragSourceDescription(source),
      guidelines,
      config,
    });
    const content = buildUserContent(source);

    // RAG 是整份文件重排，長文件輸出很長：用串流（大 max_tokens 不會逾時），並檢查有沒有被截斷
    const response = await anthropic.messages
      .stream({
        model: KM_ANALYSIS_MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        system,
        ...(hasSourceUrls(source)
          ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: webFetchMaxUses(source) }] }
          : {}),
        messages: [{ role: "user", content }],
      })
      .finalMessage();

    await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "km_rag", usage: response.usage, roleId: source.roleId });

    if (response.stop_reason === "max_tokens") {
      const truncated = "文件太長，RAG 內容輸出被截斷（後半段會遺漏），這次結果沒有保存。建議把來源拆成幾份較小的文件後再產生。";
      const { count } = await prisma.kmSource.updateMany({
        where: sameAttempt,
        data: { ragStatus: source.ragContent ? "DONE" : "FAILED", ragErrorMessage: truncated },
      });
      return { error: count ? truncated : STOPPED_MESSAGE };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!text) {
      const { count } = await prisma.kmSource.updateMany({
        where: sameAttempt,
        data: { ragStatus: "FAILED", ragErrorMessage: "沒有產出任何內容。" },
      });
      return { error: count ? "沒有產出任何內容。" : STOPPED_MESSAGE };
    }

    const { count } = await prisma.kmSource.updateMany({ where: sameAttempt, data: { ragContent: text, ragStatus: "DONE" } });
    if (!count) return { error: STOPPED_MESSAGE };

    revalidatePath(`/km/new/${sourceId}`);
    return { success: "RAG 內容已產生。" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    const { count } = await prisma.kmSource.updateMany({
      where: sameAttempt,
      data: { ragStatus: "FAILED", ragErrorMessage: message },
    });
    return { error: count ? `產出失敗：${message}` : STOPPED_MESSAGE };
  }
}

// 停止：產生過程被中斷（例如伺服器重新部署）時狀態會一直卡在「產生中」，按停止就能解除、重新產生。
// 有上一版內容就保留上一版；還在跑的請求之後回來也不會覆蓋（開始時間已經對不上）。
export async function stopRagContentAction(sourceId: string): Promise<RagActionState> {
  const session = await requireSession();

  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "找不到這份來源。" };
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) {
    return { error: "沒有權限操作這份來源。" };
  }
  if (source.ragStatus !== "PROCESSING") return { error: "目前沒有正在產生的 RAG 內容。" };

  await prisma.kmSource.update({
    where: { id: sourceId },
    data: source.ragContent
      ? { ragStatus: "DONE", ragStartedAt: null, ragErrorMessage: null }
      : { ragStatus: "FAILED", ragStartedAt: null, ragErrorMessage: "已手動停止。" },
  });

  revalidatePath(`/km/new/${sourceId}`);
  return { success: source.ragContent ? "已停止，保留上一版 RAG 內容，可以重新產生。" : "已停止，可以重新產生。" };
}
