"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/anthropic";
import { deleteUploadedFiles, verifyUpload, type SignedUpload } from "@/lib/sourceUpload";
import { checkTotals } from "@/lib/sourceLimits";
import { getSourceFiles, getSourceUrls, type SourceFileRef } from "@/lib/kmAnalysis";

// 來源檔案的檢查與替換：API key 換到別的工作區後，舊工作區上傳的檔案讀不到，
// 在既有來源上重新上傳就好（只換 Claude 上的檔案，FAQ、結構化文件、優化任務、版本都保留）

async function ownSource(sourceId: string, roleId: string) {
  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  return source && source.roleId === roleId ? source : null;
}

export type SourceFileCheck = { total: number; missing: string[]; error?: string };

// 檢查來源的文件檔在目前的 Claude 工作區還在不在（只查文件，圖片跟著同一份文件一起重傳）
export async function checkSourceFilesAction(sourceId: string): Promise<SourceFileCheck> {
  const session = await requireCompanyUser();
  const source = await ownSource(sourceId, session.roleId);
  if (!source) return { total: 0, missing: [], error: "找不到這份來源。" };
  const docs = getSourceFiles(source).filter((f) => f.kind !== "image");
  const missing: string[] = [];
  try {
    await Promise.all(
      docs.map(async (f) => {
        try {
          await anthropic.files.retrieveMetadata(f.fileId);
        } catch (err) {
          if (err instanceof Anthropic.NotFoundError) missing.push(f.fileName);
          else throw err;
        }
      }),
    );
  } catch (err) {
    return { total: docs.length, missing, error: err instanceof Error ? err.message : "檢查失敗" };
  }
  return { total: docs.length, missing };
}

export type ReplaceSourceFilesResult = { success?: string; error?: string };

// 用新上傳（簽章過）的檔案取代來源原本的檔案；網址不動
export async function replaceSourceFilesAction(sourceId: string, uploads: SignedUpload[]): Promise<ReplaceSourceFilesResult> {
  const session = await requireCompanyUser();
  const source = await ownSource(sourceId, session.roleId);
  if (!source) return { error: "找不到這份來源。" };
  if (source.status === "PROCESSING") return { error: "這份來源正在分析中，請等分析結束再替換檔案。" };
  if (uploads.length === 0) return { error: "請先選擇要上傳的檔案。" };
  const verified = uploads.map((u) => verifyUpload(session.id, u));
  if (verified.some((v) => v === null)) return { error: "檔案驗證失敗，請重新上傳。" };
  const ok = verified.filter((v): v is NonNullable<typeof v> => v !== null);
  const totals = checkTotals(ok.map((v) => v.stats));
  if (totals.level === "over") return { error: totals.message ?? "內容太多，請拆成幾個來源。" };

  const refs: SourceFileRef[] = ok.flatMap((v) => v.refs);
  const old = getSourceFiles(source);
  await prisma.kmSource.update({
    where: { id: sourceId },
    data: {
      sourceFileIds: refs,
      sourceFileId: null,
      sourceType: getSourceUrls(source).length > 0 ? "MIXED" : "PDF",
    },
  });
  // 舊檔案在目前工作區多半已經找不到，刪不掉就算了
  await deleteUploadedFiles(old);
  revalidatePath(`/km/new/${sourceId}`);
  return { success: `已替換為 ${uploads.length} 個檔案。` };
}
