import { requireCompanyAdmin } from "@/lib/session";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { getPromptConfig } from "@/lib/promptConfigStore";
import { headers } from "next/headers";
import { appBaseUrl, getLineSettings, lineBindingCode, lineWebhookPath } from "@/lib/lineNotify";
import { PromptSettings } from "./PromptSettings";
import { LineSettings } from "./LineSettings";

export default async function PromptsPage() {
  const session = await requireCompanyAdmin();

  const [guidelines, config, line] = await Promise.all([
    getSystemSetting(session.companyId, KM_OUTPUT_GUIDELINES_KEY),
    getPromptConfig(session.companyId),
    getLineSettings(session.companyId),
  ]);
  // LINE webhook 網址：優先用設定的站台網址，否則用這次請求的網址
  const h = await headers();
  const origin = appBaseUrl() ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">參數管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          設定這間公司所有 AI 產出使用的提示詞與參數：每一條規則都可以開關、修改文字，隨時還原成系統預設。AI 每次執行時都會讀取這裡的最新設定。
        </p>
      </div>

      <PromptSettings
        guidelines={guidelines}
        initialConfig={config}
        lineTab={
          <LineSettings
            view={{
              hasSecret: Boolean(line.channelSecret),
              hasToken: Boolean(line.accessToken),
              webhookUrl: `${origin}${lineWebhookPath(session.companyId)}`,
              code: lineBindingCode(session.companyId),
              groups: line.groups,
            }}
          />
        }
      />
    </div>
  );
}
