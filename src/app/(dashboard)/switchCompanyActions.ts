"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ACTIVE_COMPANY_COOKIE_NAME, ACTIVE_COMPANY_COOKIE_OPTIONS } from "@/lib/activeCompany";

export async function switchCompanyAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (session.kind !== "user") redirect("/platform/companies");

  const companyId = String(formData.get("companyId") ?? "");

  // 不能只信表單傳來的 companyId，要真的查資料庫確認這個人在這間公司底下還有啟用中的 membership。
  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId: session.id, companyId } },
  });
  if (!membership || !membership.isActive) {
    redirect("/");
  }

  const store = await cookies();
  store.set(ACTIVE_COMPANY_COOKIE_NAME, companyId, ACTIVE_COMPANY_COOKIE_OPTIONS);
  redirect("/");
}
