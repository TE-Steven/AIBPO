"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";

export type RoleActionState = { success?: string; error?: string };

export async function createRoleAction(
  _prevState: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  await requireSuperAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) {
    return { error: "角色名稱不能是空的。" };
  }

  try {
    await prisma.role.create({ data: { name, description: description || null } });
  } catch {
    return { error: "建立失敗，角色名稱可能已經存在。" };
  }

  revalidatePath("/settings/roles");
  revalidatePath("/settings/users");
  revalidatePath("/settings/menus");
  return { success: `角色「${name}」已建立。` };
}

export async function deleteRoleAction(roleId: string): Promise<void> {
  await requireSuperAdmin();

  const role = await prisma.role.findUniqueOrThrow({ where: { id: roleId } });
  if (role.isSystem) return;

  const userCount = await prisma.user.count({ where: { roleId } });
  if (userCount > 0) return;

  await prisma.role.delete({ where: { id: roleId } });
  revalidatePath("/settings/roles");
  revalidatePath("/settings/menus");
}
