"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdmin } from "@/lib/session";
import { setSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";

export type PromptActionState = { success?: string; error?: string };

export async function saveKmGuidelinesAction(
  _prevState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const session = await requireCompanyAdmin();

  const guidelines = String(formData.get("guidelines") ?? "").trim();

  await setSystemSetting(session.companyId, KM_OUTPUT_GUIDELINES_KEY, guidelines);

  revalidatePath("/settings/prompts");
  return { success: "已儲存，之後所有 KM 分析都會套用這份準則。" };
}
