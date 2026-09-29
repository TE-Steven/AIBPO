"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdmin } from "@/lib/session";
import { setSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { savePromptConfig } from "@/lib/promptConfigStore";
import type { PromptConfigData } from "@/lib/promptConfig";

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

export type PromptConfigActionResult = { success?: string; error?: string; config?: PromptConfigData };

// 儲存提示詞與參數設定（整份覆蓋；跟預設相同的值不會存，之後預設更新時沒改過的部分會自動跟上）
export async function savePromptConfigAction(config: unknown): Promise<PromptConfigActionResult> {
  const session = await requireCompanyAdmin();
  try {
    const saved = await savePromptConfig(session.companyId, config);
    revalidatePath("/settings/prompts");
    return { success: "已儲存，之後的 AI 分析、RAG、比對與匯出都會套用這份設定。", config: saved };
  } catch {
    return { error: "儲存失敗，請稍後再試。" };
  }
}
