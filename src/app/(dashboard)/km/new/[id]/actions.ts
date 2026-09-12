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
