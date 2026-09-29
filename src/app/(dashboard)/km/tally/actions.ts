"use server";

import { revalidatePath } from "next/cache";
import { requireSession, requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export type TallyActionState = { success?: string; error?: string };

const MAX_DEPTH = 3;

async function getDepth(tallyId: string): Promise<number> {
  let depth = 1;
  let current = await prisma.tally.findUnique({ where: { id: tallyId }, select: { parentId: true } });
  while (current?.parentId) {
    depth++;
    current = await prisma.tally.findUnique({ where: { id: current.parentId }, select: { parentId: true } });
  }
  return depth;
}

export async function createTallyAction(
  _prevState: TallyActionState,
  formData: FormData,
): Promise<TallyActionState> {
  const session = await requireCompanyUser();

  const name = String(formData.get("name") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "") || null;
  if (!name) {
    return { error: "分類名稱不能是空的。" };
  }

  if (parentId) {
    const parentDepth = await getDepth(parentId);
    if (parentDepth >= MAX_DEPTH) {
      return { error: `分類最多只能到第 ${MAX_DEPTH} 層，不能再往下新增。` };
    }
  }

  await prisma.tally.create({
    data: { name, parentId, roleId: session.roleId },
  });

  revalidatePath("/km/tally");
  return { success: `分類「${name}」已建立。` };
}

// 刪除分類：每一層都可以刪。底下的子分類會一併刪除（資料庫 onDelete: Cascade），
// 使用這些分類的 KM 不會被刪，只是改成未分類（onDelete: SetNull）。
export async function deleteTallyAction(tallyId: string): Promise<TallyActionState> {
  const session = await requireSession();

  const tally = await prisma.tally.findUnique({ where: { id: tallyId } });
  if (!tally) return { error: "找不到這個分類，可能已經被刪除了。" };
  if (session.kind !== "superadmin" && tally.roleId !== session.roleId) return { error: "沒有權限刪除這個分類。" };

  // 算出整棵子樹（最多三層），回報影響範圍
  const subtreeIds = [tally.id];
  let frontier = [tally.id];
  while (frontier.length > 0) {
    const children = await prisma.tally.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    frontier = children.map((c) => c.id);
    subtreeIds.push(...frontier);
  }
  const entryCount = await prisma.kmEntry.count({ where: { tallyId: { in: subtreeIds } } });

  await prisma.tally.delete({ where: { id: tallyId } });
  revalidatePath("/km/tally");
  revalidatePath("/km/knowledge");

  const extras = [
    subtreeIds.length > 1 ? `一併刪除 ${subtreeIds.length - 1} 個子分類` : null,
    entryCount > 0 ? `${entryCount} 筆 KM 已改為未分類` : null,
  ].filter(Boolean);
  return { success: `已刪除分類「${tally.name}」${extras.length > 0 ? `（${extras.join("，")}）` : ""}。` };
}
