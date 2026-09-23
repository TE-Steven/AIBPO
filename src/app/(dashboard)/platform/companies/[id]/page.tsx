import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { toggleCompanyMemberActiveAction, toggleCompanyMemberAdminAction } from "./actions";
import { CreateCompanyMemberForm, ResetCompanyMemberPasswordForm } from "./CompanyMemberForms";
import { IconUsers, IconArrowLeft, IconShieldCheck } from "@/components/icons";

export default async function PlatformCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) notFound();

  const [memberships, roles] = await Promise.all([
    prisma.companyMembership.findMany({
      where: { companyId: id },
      include: { user: true, role: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.role.findMany({ where: { companyId: id }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Link
          href="/platform/companies"
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-teal-600"
        >
          <IconArrowLeft className="h-3.5 w-3.5" />
          回平台總覽
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">{company.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          代這間公司管理成員：輸入的帳號如果已經在別間公司使用過，會直接把那個既有帳號加進來（密碼沿用原本設定），不會建立新帳號。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">新增成員</h2>
        <CreateCompanyMemberForm companyId={id} roles={roles} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">顯示名稱</th>
              <th className="px-5 py-3">帳號</th>
              <th className="px-5 py-3">角色</th>
              <th className="px-5 py-3">狀態</th>
              <th className="px-5 py-3">公司管理員</th>
              <th className="px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {memberships.map((m) => (
              <tr key={m.id}>
                <td className="flex items-center gap-2.5 px-5 py-3 font-medium text-slate-800">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                    <IconUsers className="h-3.5 w-3.5" />
                  </span>
                  {m.user.displayName}
                </td>
                <td className="px-5 py-3 text-slate-500">{m.user.username}</td>
                <td className="px-5 py-3 text-slate-500">{m.role.name}</td>
                <td className="px-5 py-3">
                  <form action={toggleCompanyMemberActiveAction.bind(null, id, m.id)}>
                    <button
                      type="submit"
                      className={`rounded-full px-2 py-0.5 text-xs font-medium transition ${
                        m.isActive
                          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      {m.isActive ? "啟用中" : "已停用"}
                    </button>
                  </form>
                </td>
                <td className="px-5 py-3">
                  <form action={toggleCompanyMemberAdminAction.bind(null, id, m.id)}>
                    <button
                      type="submit"
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition ${
                        m.isCompanyAdmin
                          ? "bg-teal-50 text-teal-600 hover:bg-teal-100"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      <IconShieldCheck className="h-3 w-3" />
                      {m.isCompanyAdmin ? "管理員" : "一般成員"}
                    </button>
                  </form>
                </td>
                <td className="px-5 py-3">
                  <ResetCompanyMemberPasswordForm companyId={id} userId={m.userId} />
                </td>
              </tr>
            ))}
            {memberships.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">
                  這間公司還沒有任何成員
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
