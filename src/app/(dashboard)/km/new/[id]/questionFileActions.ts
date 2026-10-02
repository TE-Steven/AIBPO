"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { deleteUploadedFiles, verifyUpload, type SignedUpload } from "@/lib/sourceUpload";
import { getQuestionFiles, type SourceFileRef } from "@/lib/kmAnalysis";

// 題目來源檔案（例如客服對話紀錄）：存在來源上，產生 FAQ 時勾選「自行上傳檔案當作 FAQ 題目來源」才會用到

export type QuestionFileActionResult = { success?: string; error?: string };

async function ownSource(sourceId: string, roleId: string) {
  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  return source && source.roleId === roleId ? source : null;
}

// 加入已上傳（簽章過）的題目來源檔案
export async function addQuestionFilesAction(sourceId: string, uploads: SignedUpload[]): Promise<QuestionFileActionResult> {
  const session = await requireCompanyUser();
  const source = await ownSource(sourceId, session.roleId);
  if (!source) return { error: "找不到這份來源。" };
  const verified = uploads.map((u) => verifyUpload(session.id, u));
  if (verified.some((v) => v === null)) return { error: "檔案驗證失敗，請重新上傳。" };
  const refs: SourceFileRef[] = [...getQuestionFiles(source), ...verified.flatMap((v) => v?.refs ?? [])];
  await prisma.kmSource.update({ where: { id: sourceId }, data: { questionFileIds: refs } });
  revalidatePath(`/km/new/${sourceId}`);
  return { success: `已加入 ${uploads.length} 個題目來源檔案。` };
}

// 移除一個題目來源檔案（連同它裡面取出的圖片），並從 Claude 刪除
export async function removeQuestionFileAction(sourceId: string, fileName: string): Promise<QuestionFileActionResult> {
  const session = await requireCompanyUser();
  const source = await ownSource(sourceId, session.roleId);
  if (!source) return { error: "找不到這份來源。" };
  const all = getQuestionFiles(source);
  const removed = all.filter((r) => r.fileName === fileName);
  const kept = all.filter((r) => r.fileName !== fileName);
  await prisma.kmSource.update({ where: { id: sourceId }, data: { questionFileIds: kept.length > 0 ? kept : [] } });
  await deleteUploadedFiles(removed);
  revalidatePath(`/km/new/${sourceId}`);
  return { success: "已移除。" };
}
