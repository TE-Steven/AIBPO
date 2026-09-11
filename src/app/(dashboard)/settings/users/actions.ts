"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export type UserActionState = { success?: string; error?: string };

export async function createUserAction(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  await requireSuperAdmin();

  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const roleId = String(formData.get("roleId") ?? "");

  if (!username || !displayName || !roleId) {
    return { error: "帳號、顯示名稱、角色都是必填。" };
  }
  if (password.length < 6) {
    return { error: "密碼至少需要 6 個字元。" };
  }

  const passwordHash = await hashPassword(password);

  try {
    await prisma.user.create({
      data: { username, displayName, passwordHash, roleId },
    });
  } catch {
    return { error: "建立失敗，帳號可能已經存在。" };
  }

  revalidatePath("/settings/users");
  revalidatePath("/team");
  return { success: `帳號「${username}」已建立。` };
}

export async function toggleUserActiveAction(userId: string): Promise<void> {
  await requireSuperAdmin();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.user.update({ where: { id: userId }, data: { isActive: !user.isActive } });
  revalidatePath("/settings/users");
  revalidatePath("/team");
}

export async function resetUserPasswordAction(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  await requireSuperAdmin();

  const userId = String(formData.get("userId") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword.length < 6) {
    return { error: "新密碼至少需要 6 個字元。" };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { success: "密碼已重設。" };
}
