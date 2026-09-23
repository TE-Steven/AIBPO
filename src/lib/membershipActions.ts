import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export type MembershipActionResult = {
  success?: string;
  error?: string;
  needsConfirm?: { username: string; existingDisplayName: string; roleId: string };
};

/**
 * 這幾個函式不做任何權限檢查——呼叫端（company-admin 版的 settings/users/actions.ts、
 * superadmin 版的 platform/companies/[id]/actions.ts）要各自先驗證身分、決定 companyId
 * 可不可信，再傳進來。不要直接把使用者能控制的 companyId 傳給這裡。
 */

export async function createOrAttachMember(
  companyId: string,
  input: { username: string; displayName: string; password: string; roleId: string; confirmed?: boolean },
): Promise<MembershipActionResult> {
  const { username, displayName, password, roleId, confirmed } = input;

  if (!username || !roleId) {
    return { error: "帳號、角色都是必填。" };
  }

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.companyId !== companyId) {
    return { error: "角色不存在。" };
  }

  const existing = await prisma.user.findUnique({ where: { username } });

  // 帳號已經存在：這是別間公司的既有身分，不是新帳號，不能幫對方設密碼/改顯示名稱，
  // 只把這個既有身分加進這間公司底下——對方之後用原本的帳密登入就能切換過來。
  // 因為帳號名稱可能是巧合撞名、不是真的同一個人，先回報身分資訊讓管理員確認過一次才真的寫入。
  if (existing) {
    const alreadyMember = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: existing.id, companyId } },
    });
    if (alreadyMember) {
      return { error: "這個帳號已經是這間公司的成員了。" };
    }

    if (!confirmed) {
      return { needsConfirm: { username, existingDisplayName: existing.displayName, roleId } };
    }

    await prisma.companyMembership.create({
      data: { userId: existing.id, companyId, roleId },
    });

    return { success: `已將既有帳號「${username}」加入這間公司（密碼沿用該帳號原本的設定）。` };
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
      await tx.companyMembership.create({ data: { userId: user.id, companyId, roleId } });
    });
  } catch {
    return { error: "建立失敗，請再試一次。" };
  }

  return { success: `已建立新帳號「${username}」。` };
}

export async function toggleMembershipActive(companyId: string, membershipId: string): Promise<void> {
  const membership = await prisma.companyMembership.findUniqueOrThrow({ where: { id: membershipId } });
  if (membership.companyId !== companyId) return;

  await prisma.companyMembership.update({ where: { id: membershipId }, data: { isActive: !membership.isActive } });
}

export async function toggleMembershipCompanyAdmin(companyId: string, membershipId: string): Promise<void> {
  const membership = await prisma.companyMembership.findUniqueOrThrow({ where: { id: membershipId } });
  if (membership.companyId !== companyId) return;

  await prisma.companyMembership.update({
    where: { id: membershipId },
    data: { isCompanyAdmin: !membership.isCompanyAdmin },
  });
}

export async function resetMemberPassword(
  companyId: string,
  input: { userId: string; newPassword: string },
): Promise<MembershipActionResult> {
  const { userId, newPassword } = input;
  if (newPassword.length < 6) {
    return { error: "新密碼至少需要 6 個字元。" };
  }

  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) {
    return { error: "找不到這個帳號。" };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { success: "密碼已重設（這是這個帳號的共用密碼，其他公司也會一起變更）。" };
}
