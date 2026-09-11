"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";

export type MenuActionState = { success?: string; error?: string };

export async function createMenuAction(
  _prevState: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  await requireSuperAdmin();

  const key = String(formData.get("key") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const path = String(formData.get("path") ?? "").trim();
  const icon = String(formData.get("icon") ?? "") || null;
  const order = Number(formData.get("order") ?? 0) || 0;

  if (!key || !label || !path.startsWith("/")) {
    return { error: "識別碼、名稱必填，路徑必須以「/」開頭。" };
  }

  try {
    await prisma.menu.create({ data: { key, label, path, icon, order } });
  } catch {
    return { error: "建立失敗，識別碼可能已經存在。" };
  }

  revalidatePath("/settings/menus");
  revalidatePath("/", "layout");
  return { success: `選單「${label}」已建立，記得到下方勾選哪些角色可以看到它。` };
}

export async function deleteMenuAction(menuId: string): Promise<void> {
  await requireSuperAdmin();
  await prisma.menu.delete({ where: { id: menuId } });
  revalidatePath("/settings/menus");
  revalidatePath("/", "layout");
}

export async function toggleRoleMenuAction(roleId: string, menuId: string, checked: boolean): Promise<void> {
  await requireSuperAdmin();

  if (checked) {
    await prisma.roleMenu.upsert({
      where: { roleId_menuId: { roleId, menuId } },
      update: {},
      create: { roleId, menuId },
    });
  } else {
    await prisma.roleMenu.deleteMany({ where: { roleId, menuId } });
  }

  revalidatePath("/settings/menus");
  revalidatePath("/", "layout");
}
