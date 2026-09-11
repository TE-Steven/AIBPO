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

export async function loginAction(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  let subject: string | null = null;

  if (verifySuperAdminCredentials(username, password)) {
    subject = SUPER_ADMIN_SUBJECT;
  } else {
    const user = await prisma.user.findUnique({ where: { username } });
    if (user && user.isActive && (await verifyPassword(password, user.passwordHash))) {
      subject = user.id;
    }
  }

  if (!subject) {
    redirect("/login?error=1");
  }

  const token = createSessionToken(subject);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
