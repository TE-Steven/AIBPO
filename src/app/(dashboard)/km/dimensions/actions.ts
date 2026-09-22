"use server";

import { revalidatePath } from "next/cache";
import { requireSession, requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export type DimensionActionState = { success?: string; error?: string };

export async function createDimensionAction(
  _prevState: DimensionActionState,
  formData: FormData,
): Promise<DimensionActionState> {
  const session = await requireCompanyUser();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) {
    return { error: "維度名稱不能是空的。" };
  }

  try {
    await prisma.dimension.create({ data: { name, description: description || null, roleId: session.roleId } });
  } catch {
    return { error: "建立失敗，這個維度名稱可能已經存在。" };
  }

  revalidatePath("/km/dimensions");
  return { success: `維度「${name}」已建立。` };
}

export async function deleteDimensionAction(dimensionId: string): Promise<void> {
  const session = await requireSession();

  const dimension = await prisma.dimension.findUnique({ where: { id: dimensionId } });
  if (!dimension) return;
  if (session.kind !== "superadmin" && dimension.roleId !== session.roleId) return;

  await prisma.dimension.delete({ where: { id: dimensionId } });
  revalidatePath("/km/dimensions");
}
