"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
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
