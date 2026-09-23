import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { estimateUsdCost, USD_TO_TWD_RATE } from "@/lib/anthropic";
import { IconMenuList } from "@/components/icons";

function formatNumber(n: number) {
  return n.toLocaleString("zh-TW");
}

export default async function PlatformCompaniesPage() {
  await requireSuperAdmin();

  const companies = await prisma.company.findMany({
    include: {
      _count: { select: { memberships: true, roles: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const [sourceCounts, agentCounts, usageByCompanyModel] = await Promise.all([
    prisma.kmSource.groupBy({ by: ["roleId"], _count: { _all: true } }),
    prisma.agent.groupBy({ by: ["roleId"], _count: { _all: true } }),
    prisma.apiUsageLog.groupBy({ by: ["companyId", "model"], _sum: { inputTokens: true, outputTokens: true } }),
  ]);

  const rolesByCompany = await prisma.role.findMany({ select: { id: true, companyId: true } });
  const companyIdByRoleId = new Map(rolesByCompany.map((r) => [r.id, r.companyId]));

  function sumByCompany(rows: { roleId: string; _count: { _all: number } }[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
      const companyId = companyIdByRoleId.get(row.roleId);
      if (!companyId) continue;
      map.set(companyId, (map.get(companyId) ?? 0) + row._count._all);
    }
    return map;
  }

  const sourceCountByCompany = sumByCompany(sourceCounts);
  const agentCountByCompany = sumByCompany(agentCounts);

  const usdCostByCompany = new Map<string, number>();
  for (const row of usageByCompanyModel) {
    if (!row.companyId) continue;
    const cost = estimateUsdCost(row.model, row._sum.inputTokens ?? 0, row._sum.outputTokens ?? 0);
    usdCostByCompany.set(row.companyId, (usdCostByCompany.get(row.companyId) ?? 0) + cost);
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">平台總覽</h1>
        <p className="mt-1 text-sm text-slate-500">
          所有公司的維運視角，僅供查看，不提供編輯——租戶自己的帳號/角色/資料請由各公司的公司管理員自行管理。
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">公司</th>
              <th className="px-5 py-3">建立時間</th>
              <th className="px-5 py-3">使用者數</th>
              <th className="px-5 py-3">角色數</th>
              <th className="px-5 py-3">KM 來源數</th>
              <th className="px-5 py-3">Agent 數</th>
              <th className="px-5 py-3">預估花費（美金）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {companies.map((c) => (
              <tr key={c.id}>
                <td className="flex items-center gap-2.5 px-5 py-3 font-medium text-slate-800">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                    <IconMenuList className="h-3.5 w-3.5" />
                  </span>
                  {c.name}
                </td>
                <td className="px-5 py-3 text-slate-500">{c.createdAt.toLocaleDateString("zh-TW")}</td>
                <td className="px-5 py-3 text-slate-500">{formatNumber(c._count.memberships)}</td>
                <td className="px-5 py-3 text-slate-500">{formatNumber(c._count.roles)}</td>
                <td className="px-5 py-3 text-slate-500">{formatNumber(sourceCountByCompany.get(c.id) ?? 0)}</td>
                <td className="px-5 py-3 text-slate-500">{formatNumber(agentCountByCompany.get(c.id) ?? 0)}</td>
                <td className="px-5 py-3 text-slate-500">
                  ${(usdCostByCompany.get(c.id) ?? 0).toFixed(2)}
                  <span className="ml-1 text-xs text-slate-400">
                    (NT${formatNumber(Math.round((usdCostByCompany.get(c.id) ?? 0) * USD_TO_TWD_RATE))})
                  </span>
                </td>
              </tr>
            ))}
            {companies.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                  尚未有任何公司註冊
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
