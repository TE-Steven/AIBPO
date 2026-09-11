"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

export type ProfileActionState = { success?: string; error?: string };

export async function updateDisplayNameAction(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const session = await requireSession();
  if (session.kind !== "user") {
    return { error: "超級管理員的名稱由環境變數控制，無法在此修改。" };
  }

  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) {
    return { error: "顯示名稱不能是空的。" };
  }

  await prisma.user.update({ where: { id: session.id }, data: { displayName } });
  revalidatePath("/", "layout");
  return { success: "顯示名稱已更新。" };
}

export async function changePasswordAction(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const session = await requireSession();
  if (session.kind !== "user") {
    return { error: "超級管理員的密碼由 Render 環境變數控制，無法在此修改。" };
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword.length < 6) {
    return { error: "新密碼至少需要 6 個字元。" };
  }
  if (newPassword !== confirmPassword) {
    return { error: "兩次輸入的新密碼不一致。" };
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.id } });
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    return { error: "目前密碼不正確。" };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: session.id }, data: { passwordHash } });
  return { success: "密碼已更新，下次登入請使用新密碼。" };
}
