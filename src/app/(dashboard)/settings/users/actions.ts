"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdmin } from "@/lib/session";
import {
  createOrAttachMember,
  toggleMembershipActive,
  resetMemberPassword,
  type MembershipActionResult,
} from "@/lib/membershipActions";

export type UserActionState = MembershipActionResult;

export async function createUserAction(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const session = await requireCompanyAdmin();

  const result = await createOrAttachMember(session.companyId, {
    username: String(formData.get("username") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    roleId: String(formData.get("roleId") ?? ""),
    confirmed: String(formData.get("confirmed") ?? "") === "true",
  });

  if (result.success) {
    revalidatePath("/settings/users");
    revalidatePath("/team");
  }
  return result;
}

export async function toggleUserActiveAction(membershipId: string): Promise<void> {
  const session = await requireCompanyAdmin();
  await toggleMembershipActive(session.companyId, membershipId);
  revalidatePath("/settings/users");
  revalidatePath("/team");
}

export async function resetUserPasswordAction(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const session = await requireCompanyAdmin();

  return resetMemberPassword(session.companyId, {
    userId: String(formData.get("userId") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  });
}
