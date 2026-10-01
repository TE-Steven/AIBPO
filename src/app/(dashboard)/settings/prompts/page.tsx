import { requireCompanyAdmin } from "@/lib/session";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { getPromptConfig } from "@/lib/promptConfigStore";
import { PromptSettings } from "./PromptSettings";

export default async function PromptsPage() {
  const session = await requireCompanyAdmin();

  const [guidelines, config] = await Promise.all([
    getSystemSetting(session.companyId, KM_OUTPUT_GUIDELINES_KEY),
    getPromptConfig(session.companyId),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">參數管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          設定這間公司所有 AI 產出使用的提示詞與參數：每一條規則都可以開關、修改文字，隨時還原成系統預設。AI 每次執行時都會讀取這裡的最新設定。
        </p>
      </div>

      <PromptSettings guidelines={guidelines} initialConfig={config} />
    </div>
  );
}
