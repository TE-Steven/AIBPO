"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { setSystemSetting, BOT_TEST_TARGET_KEY } from "@/lib/systemSettings";
import {
  createOrAttachMember,
  toggleMembershipActive,
  toggleMembershipCompanyAdmin,
  resetMemberPassword,
  type MembershipActionResult,
} from "@/lib/membershipActions";

export type CompanyMemberActionState = MembershipActionResult;

export async function createCompanyMemberAction(
  _prevState: CompanyMemberActionState,
  formData: FormData,
): Promise<CompanyMemberActionState> {
  await requireSuperAdmin();

  const companyId = String(formData.get("companyId") ?? "");
  const result = await createOrAttachMember(companyId, {
    username: String(formData.get("username") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    roleId: String(formData.get("roleId") ?? ""),
    confirmed: String(formData.get("confirmed") ?? "") === "true",
  });

  if (result.success) {
    revalidatePath(`/platform/companies/${companyId}`);
  }
  return result;
}

export async function toggleCompanyMemberActiveAction(companyId: string, membershipId: string): Promise<void> {
  await requireSuperAdmin();
  await toggleMembershipActive(companyId, membershipId);
  revalidatePath(`/platform/companies/${companyId}`);
}

export async function toggleCompanyMemberAdminAction(companyId: string, membershipId: string): Promise<void> {
  await requireSuperAdmin();
  await toggleMembershipCompanyAdmin(companyId, membershipId);
  revalidatePath(`/platform/companies/${companyId}`);
}

export async function resetCompanyMemberPasswordAction(
  _prevState: CompanyMemberActionState,
  formData: FormData,
): Promise<CompanyMemberActionState> {
  await requireSuperAdmin();

  const companyId = String(formData.get("companyId") ?? "");
  return resetMemberPassword(companyId, {
    userId: String(formData.get("userId") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  });
}

export type BotTestTargetActionState = { success?: string; error?: string };

function normalizeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export async function saveBotTestTargetAction(
  _prevState: BotTestTargetActionState,
  formData: FormData,
): Promise<BotTestTargetActionState> {
  await requireSuperAdmin();

  const companyId = String(formData.get("companyId") ?? "");
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: "找不到這間公司。" };

  const workflowBaseUrl = normalizeHttpsUrl(String(formData.get("workflowBaseUrl") ?? ""));
  const gatewayBaseUrl = normalizeHttpsUrl(String(formData.get("gatewayBaseUrl") ?? ""));
  const platformId = String(formData.get("platformId") ?? "").trim();
  if (!workflowBaseUrl || !gatewayBaseUrl) return { error: "送題與取答案網址都要填，而且必須是 https:// 開頭。" };
  if (!platformId) return { error: "請填 channel（platformId）。" };

  await setSystemSetting(companyId, BOT_TEST_TARGET_KEY, JSON.stringify({ workflowBaseUrl, gatewayBaseUrl, platformId }));
  revalidatePath(`/platform/companies/${companyId}`);
  return { success: "已儲存，這間公司的機器人測試會打這組 API。" };
}
