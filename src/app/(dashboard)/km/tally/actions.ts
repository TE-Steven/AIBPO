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

export async function deleteTallyAction(tallyId: string): Promise<void> {
  const session = await requireSession();

  const tally = await prisma.tally.findUnique({
    where: { id: tallyId },
    include: { _count: { select: { children: true, kmEntries: true } } },
  });
  if (!tally) return;
  if (session.kind !== "superadmin" && tally.roleId !== session.roleId) return;
  if (tally._count.children > 0 || tally._count.kmEntries > 0) return;

  await prisma.tally.delete({ where: { id: tallyId } });
  revalidatePath("/km/tally");
}
