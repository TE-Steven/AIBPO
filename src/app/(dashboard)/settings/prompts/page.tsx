import { requireSuperAdmin } from "@/lib/session";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { PromptForm } from "./PromptForm";

export default async function PromptsPage() {
  await requireSuperAdmin();

  const guidelines = await getSystemSetting(KM_OUTPUT_GUIDELINES_KEY);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Prompt 管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          在這裡定義的準則，優先於任何使用者在「新增KM」自訂的分析參數，會套用在所有 KM 分析與問答上。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">KM 輸出最高準則</h2>
        <PromptForm defaultValue={guidelines} />
      </div>
    </div>
  );
}
