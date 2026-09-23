"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export type UserActionState = { success?: string; error?: string };

export async function createUserAction(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const session = await requireCompanyAdmin();

  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const roleId = String(formData.get("roleId") ?? "");

  if (!username || !roleId) {
    return { error: "帳號、角色都是必填。" };
  }

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.companyId !== session.companyId) {
    return { error: "角色不存在。" };
  }

  const existing = await prisma.user.findUnique({ where: { username } });

  // 帳號已經存在：這是別間公司的既有身分，不是新帳號，管理員不能幫對方設密碼/改顯示名稱，
  // 只把這個既有身分加進自己公司底下——對方之後用原本的帳密登入就能切換過來。
  if (existing) {
    const alreadyMember = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: existing.id, companyId: session.companyId } },
    });
    if (alreadyMember) {
      return { error: "這個帳號已經是貴公司的成員了。" };
    }

    await prisma.companyMembership.create({
      data: { userId: existing.id, companyId: session.companyId, roleId },
    });

    revalidatePath("/settings/users");
    revalidatePath("/team");
    return { success: `已將既有帳號「${username}」加入貴公司（密碼沿用該帳號原本的設定）。` };
  }

  if (!displayName) {
    return { error: "建立新帳號時，顯示名稱是必填。" };
  }
  if (password.length < 6) {
    return { error: "建立新帳號時，密碼至少需要 6 個字元。" };
  }

  const passwordHash = await hashPassword(password);

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { username, displayName, passwordHash } });
      await tx.companyMembership.create({ data: { userId: user.id, companyId: session.companyId, roleId } });
    });
  } catch {
    return { error: "建立失敗，請再試一次。" };
  }

  revalidatePath("/settings/users");
  revalidatePath("/team");
  return { success: `已建立新帳號「${username}」。` };
}

export async function toggleUserActiveAction(membershipId: string): Promise<void> {
  const session = await requireCompanyAdmin();
  const membership = await prisma.companyMembership.findUniqueOrThrow({ where: { id: membershipId } });
  if (membership.companyId !== session.companyId) return;

  await prisma.companyMembership.update({ where: { id: membershipId }, data: { isActive: !membership.isActive } });
  revalidatePath("/settings/users");
  revalidatePath("/team");
}

export async function resetUserPasswordAction(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const session = await requireCompanyAdmin();

  const userId = String(formData.get("userId") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword.length < 6) {
    return { error: "新密碼至少需要 6 個字元。" };
  }

  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId: session.companyId } },
  });
  if (!membership) {
    return { error: "找不到這個帳號。" };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { success: "密碼已重設（這是這個帳號的共用密碼，其他公司也會一起變更）。" };
}
