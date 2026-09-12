"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function updateKmEntryAction(
  entryId: string,
  data: { question?: string; answer?: string; tallyId?: string | null },
): Promise<void> {
  const session = await requireSession();

  const entry = await prisma.kmEntry.findUnique({ where: { id: entryId } });
  if (!entry) return;
  if (session.kind !== "superadmin" && entry.roleId !== session.roleId) return;

  await prisma.kmEntry.update({
    where: { id: entryId },
    data: {
      ...(data.question !== undefined ? { question: data.question } : {}),
      ...(data.answer !== undefined ? { answer: data.answer } : {}),
      ...(data.tallyId !== undefined ? { tallyId: data.tallyId } : {}),
    },
  });

  revalidatePath(`/km/new/${entry.sourceId}`);
  revalidatePath("/km/knowledge");
}

export async function deleteKmEntryAction(entryId: string): Promise<void> {
  const session = await requireSession();

  const entry = await prisma.kmEntry.findUnique({ where: { id: entryId } });
  if (!entry) return;
  if (session.kind !== "superadmin" && entry.roleId !== session.roleId) return;

  await prisma.kmEntry.delete({ where: { id: entryId } });
  revalidatePath(`/km/new/${entry.sourceId}`);
  revalidatePath("/km/knowledge");
}

/** 「新增KM」勾選確認後，把選定的題目納入知識列表；再點一次可以取消收錄。 */
export async function setKmEntriesConfirmedAction(entryIds: string[], confirmed: boolean): Promise<void> {
  const session = await requireSession();
  if (entryIds.length === 0) return;

  await prisma.kmEntry.updateMany({
    where: {
      id: { in: entryIds },
      ...(session.kind === "superadmin" ? {} : { roleId: session.roleId }),
    },
    data: { confirmed },
  });

  revalidatePath("/km/knowledge");
}
