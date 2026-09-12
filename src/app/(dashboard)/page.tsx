import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { estimateUsdCost, USD_TO_TWD_RATE } from "@/lib/anthropic";
import { IconSparkles, IconCheckCircle, IconMenuList, IconShieldCheck } from "@/components/icons";

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

  const scope = roleScope(session);
  const [sourceCount, knowledgeCount, tallyCount, dimensionCount] = await Promise.all([
    prisma.kmSource.count({ where: scope }),
    prisma.kmEntry.count({ where: { confirmed: true, ...scope } }),
    prisma.tally.count({ where: scope }),
    prisma.dimension.count({ where: scope }),
  ]);

  const statCards = [
    { label: "資料來源數量", value: sourceCount, icon: IconSparkles },
    { label: "知識數量", value: knowledgeCount, icon: IconCheckCircle },
    { label: "分類數量", value: tallyCount, icon: IconMenuList },
    { label: "維度數量", value: dimensionCount, icon: IconShieldCheck },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">歡迎回來，{displayName}</h1>
        <p className="mt-1 text-sm text-slate-500">目前身分：{roleLabel}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
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
          <div className="rounded-lg bg-teal-50 p-4">
            <p className="text-xs text-teal-500">預估花費（台幣）</p>
            <p className="mt-1 text-lg font-semibold text-teal-700">NT${formatNumber(Math.round(totalTwdCost))}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          依 Claude 官方定價估算，匯率抓 1 美金 = {USD_TO_TWD_RATE} 台幣（非即時匯率，僅供參考）。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <card.icon className="h-4 w-4" />
              </span>
              <p className="text-xs text-slate-500">{card.label}</p>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-900">{formatNumber(card.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
