import { getSystemSetting, setSystemSetting } from "@/lib/systemSettings";
import { PROMPT_CONFIG_KEY, sanitizePromptConfig, type PromptConfigData } from "@/lib/promptConfig";

// 公司的提示詞設定：沒設定過或資料壞掉時回傳空設定（＝全部用預設）
export async function getPromptConfig(companyId: string): Promise<PromptConfigData> {
  const raw = await getSystemSetting(companyId, PROMPT_CONFIG_KEY);
  if (!raw) return {};
  try {
    return sanitizePromptConfig(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function savePromptConfig(companyId: string, config: unknown): Promise<PromptConfigData> {
  const clean = sanitizePromptConfig(config);
  await setSystemSetting(companyId, PROMPT_CONFIG_KEY, JSON.stringify(clean));
  return clean;
}
