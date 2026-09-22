import { requireCompanyAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { deleteRoleAction } from "./actions";
import { CreateRoleForm } from "./RoleForms";
import { IconShieldCheck, IconTrash } from "@/components/icons";

export default async function RolesPage() {
  const session = await requireCompanyAdmin();

  const roles = await prisma.role.findMany({
    where: { companyId: session.companyId },
    include: { _count: { select: { users: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">角色管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          角色決定了「資料權限」（同角色互相看得到彼此資料）與可搭配的選單權限。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">新增角色</h2>
        <CreateRoleForm />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">角色</th>
              <th className="px-5 py-3">說明</th>
              <th className="px-5 py-3">成員數</th>
              <th className="px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roles.map((r) => {
              const deletable = !r.isSystem && r._count.users === 0;
              return (
                <tr key={r.id}>
                  <td className="flex items-center gap-2.5 px-5 py-3 font-medium text-slate-800">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                      <IconShieldCheck className="h-3.5 w-3.5" />
                    </span>
                    {r.name}
                    {r.isSystem && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">系統預設</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{r.description || "—"}</td>
                  <td className="px-5 py-3 text-slate-500">{r._count.users}</td>
                  <td className="px-5 py-3">
                    {deletable ? (
                      <form action={deleteRoleAction.bind(null, r.id)}>
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                          刪除
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-slate-300">
                        {r.isSystem ? "系統角色不可刪除" : "尚有成員，無法刪除"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
