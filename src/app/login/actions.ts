"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import {
  createSessionToken,
  verifySuperAdminCredentials,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SUPER_ADMIN_SUBJECT,
} from "@/lib/auth";
import { ACTIVE_COMPANY_COOKIE_NAME } from "@/lib/activeCompany";

export async function loginAction(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  let subject: string | null = null;

  if (verifySuperAdminCredentials(username, password)) {
    subject = SUPER_ADMIN_SUBJECT;
  } else {
    // 帳號本身驗證只看帳密，是否有效是「這個人在哪些公司還有啟用中的 membership」的事，交給 getSession() 判斷。
    const user = await prisma.user.findUnique({ where: { username } });
    if (user && (await verifyPassword(password, user.passwordHash))) {
      subject = user.id;
    }
  }

  if (!subject) {
    redirect("/login?error=1");
  }

  const token = createSessionToken(subject);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
  // 避免同一瀏覽器殘留上一個人（或這個人上次）選過的公司。
  store.delete(ACTIVE_COMPANY_COOKIE_NAME);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  store.delete(ACTIVE_COMPANY_COOKIE_NAME);
  redirect("/login");
}
