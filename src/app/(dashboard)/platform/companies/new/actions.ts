"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { provisionCompany } from "@/lib/companyProvisioning";

export type CreateCompanyState = { error?: string };

export async function createCompanyAction(
  _prevState: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  await requireSuperAdmin();

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

  // 超級管理員只是「代開」，不會變成登入那間公司——建完人還是超級管理員身分，導回公司總覽。
  await provisionCompany({ companyName, username, displayName, password });

  revalidatePath("/platform/companies");
  redirect("/platform/companies");
}
