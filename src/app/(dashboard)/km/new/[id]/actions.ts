"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function updateKmSourceTitleAction(sourceId: string, title: string): Promise<void> {
  const session = await requireSession();
  const trimmed = title.trim();
  if (!trimmed) return;

  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  if (!source) return;
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) return;

  await prisma.kmSource.update({ where: { id: sourceId }, data: { title: trimmed } });
  revalidatePath(`/km/new/${sourceId}`);
  revalidatePath("/km/new");
}

// 停止分析：分析中途被中斷（伺服器重新部署、斷線）時來源會一直卡在「分析中」，按停止就能解除。
// FAQ 已經存好的話就當作完成（結構化文件之後可以在來源頁重新產生）；還沒有任何題目就標失敗，可以重新分析。
// 還在跑的請求之後回來也不會寫入（analysisStartedAt 已經對不上）。
export async function stopKmAnalysisAction(sourceId: string): Promise<{ success?: string; error?: string }> {
  const session = await requireSession();

  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "找不到這份來源。" };
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) return { error: "沒有權限操作這份來源。" };
  if (source.status !== "PROCESSING") return { error: "這個來源目前沒有在分析。" };

  const entryCount = await prisma.kmEntry.count({ where: { sourceId } });
  await prisma.kmSource.update({
    where: { id: sourceId },
    data:
      entryCount > 0
        ? { status: "DONE", analysisStartedAt: null, errorMessage: null }
        : { status: "FAILED", analysisStartedAt: null, errorMessage: "已手動停止。" },
  });

  revalidatePath(`/km/new/${sourceId}`);
  return { success: entryCount > 0 ? "已停止，保留已產生的題目。" : "已停止，可以重新分析。" };
}
