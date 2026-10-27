import Link from "next/link";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AUTOMATION_STATUS, cleanFields } from "@/lib/automationFields";
import { LocalTime } from "@/components/LocalTime";
import { CreateAutomationForm } from "./CreateAutomationForm";
import { AutomationGuide } from "./AutomationGuide";
import { InfoTip } from "../optimize/optimizeShared";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const session = await requireCompanyUser();
  const forms = await prisma.automationForm.findMany({
    where: { roleId: session.roleId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, domain: true, status: true, fields: true, analyzedAt: true, createdAt: true },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">自動化管理</h1>
          <AutomationGuide />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          貼上網頁表單的網址，AI 會用瀏覽器打開表單、分析有哪些欄位，整理成欄位清單；確認後就能產生 API，讓機器人或其他系統呼叫時自動代為填寫並送出（API 與代為送出在下一階段開放）。
        </p>
      </div>

      <CreateAutomationForm />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {forms.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">還沒有登記任何表單。</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2.5 font-medium">表單</th>
                <th className="py-2.5 font-medium">網域</th>
                <th className="py-2.5 font-medium">
                  <span className="inline-flex items-center">
                    狀態
                    <InfoTip>等待分析：排隊等背景 Worker。分析中：瀏覽器打開表單、AI 整理欄位。待確認：欄位清單已產生，請人工確認。已啟用：可以用 API 呼叫。不支援：有驗證碼、登入或付款欄位。分析失敗：打不開頁面或 AI 分析出錯，可以重新分析。</InfoTip>
                  </span>
                </th>
                <th className="py-2.5 text-right font-medium">
                  <span className="inline-flex items-center">
                    欄位
                    <InfoTip>AI 整理出的欄位數（括號內為必填數），包含標成「不讓 API 填」的欄位。</InfoTip>
                  </span>
                </th>
                <th className="py-2.5 pr-5 text-right font-medium">
                  <span className="inline-flex items-center">
                    最近分析
                    <InfoTip>最近一次分析完成的時間。表單改版後到表單頁按「重新分析」。</InfoTip>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {forms.map((f) => {
                const status = AUTOMATION_STATUS[f.status] ?? AUTOMATION_STATUS.DRAFT;
                const fields = cleanFields(f.fields);
                return (
                  <tr key={f.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <Link href={`/automations/${f.id}`} className="font-medium text-teal-700 hover:underline">
                        {f.name}
                      </Link>
                    </td>
                    <td className="py-3 text-slate-500">{f.domain}</td>
                    <td className="py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${status.className}`}>{status.label}</span>
                    </td>
                    <td className="py-3 text-right tabular-nums text-slate-600">
                      {fields.length > 0 ? `${fields.length} 個（必填 ${fields.filter((x) => x.required).length}）` : "—"}
                    </td>
                    <td className="py-3 pr-5 text-right text-xs text-slate-500">{f.analyzedAt ? <LocalTime iso={f.analyzedAt.toISOString()} /> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
