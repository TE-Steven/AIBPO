import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { estimateUsdCost, USD_TO_TWD_RATE } from "@/lib/anthropic";
import { IconDashboard, IconSparkles } from "@/components/icons";

function formatNumber(n: number) {
  return n.toLocaleString("zh-TW");
}

export default async function DashboardHomePage() {
  const session = await requireSession();

  const displayName = session.displayName;
  const roleLabel = session.kind === "superadmin" ? "超級管理員" : session.roleName;

  // 用量統計是全公司共用的實際花費，不套資料權限（不分角色，全部人看到的是同一組數字）。
  const usageByModel = await prisma.apiUsageLog.groupBy({
    by: ["model"],
    _sum: { inputTokens: true, outputTokens: true },
  });

  const totalInputTokens = usageByModel.reduce((sum, row) => sum + (row._sum.inputTokens ?? 0), 0);
  const totalOutputTokens = usageByModel.reduce((sum, row) => sum + (row._sum.outputTokens ?? 0), 0);
  const totalUsdCost = usageByModel.reduce(
    (sum, row) => sum + estimateUsdCost(row.model, row._sum.inputTokens ?? 0, row._sum.outputTokens ?? 0),
    0,
  );
  const totalTwdCost = totalUsdCost * USD_TO_TWD_RATE;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">歡迎回來，{displayName}</h1>
        <p className="mt-1 text-sm text-slate-500">目前身分：{roleLabel}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <IconSparkles className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-slate-900">AI 用量統計（累積至今）</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs text-slate-500">輸入 tokens</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(totalInputTokens)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs text-slate-500">輸出 tokens</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(totalOutputTokens)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs text-slate-500">預估花費（美金）</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">${totalUsdCost.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-violet-50 p-4">
            <p className="text-xs text-violet-500">預估花費（台幣）</p>
            <p className="mt-1 text-lg font-semibold text-violet-700">NT${formatNumber(Math.round(totalTwdCost))}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          依 Claude 官方定價估算，匯率抓 1 美金 = {USD_TO_TWD_RATE} 台幣（非即時匯率，僅供參考）。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <IconDashboard className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">這是 AIBPO 後台首頁</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              左側選單依你的角色權限顯示，可到「個人設定」修改密碼與顯示名稱。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
