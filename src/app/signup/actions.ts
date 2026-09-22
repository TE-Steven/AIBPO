"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth";

export type SignupActionState = { error?: string };

export async function signupAction(_prevState: SignupActionState, formData: FormData): Promise<SignupActionState> {
  const companyName = String(formData.get("companyName") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!companyName || !username || !displayName) {
    return { error: "公司名稱、帳號、顯示名稱都是必填。" };
  }
  if (password.length < 6) {
    return { error: "密碼至少需要 6 個字元。" };
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return { error: "這個帳號已經被使用，換一個看看。" };
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { name: companyName } });
    const role = await tx.role.create({
      data: { companyId: company.id, name: "管理者", description: "公司管理員的預設角色", isSystem: true },
    });
    const createdUser = await tx.user.create({
      data: { username, displayName, passwordHash, companyId: company.id, roleId: role.id, isCompanyAdmin: true },
    });

    // 讓新公司一註冊完就有完整功能可用：把全站共用的選單目錄，整包授權給這個新角色。
    const menus = await tx.menu.findMany();
    if (menus.length > 0) {
      await tx.roleMenu.createMany({ data: menus.map((m) => ({ roleId: role.id, menuId: m.id })) });
    }

    return createdUser;
  });

  const token = createSessionToken(user.id);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
  redirect("/");
}
