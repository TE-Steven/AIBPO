import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { toggleUserActiveAction } from "./actions";
import { CreateUserForm, ResetPasswordForm } from "./UsersForms";
import { IconUsers } from "@/components/icons";

export default async function UsersPage() {
  await requireSuperAdmin();

  const [users, roles] = await Promise.all([
    prisma.user.findMany({ include: { role: true }, orderBy: { createdAt: "asc" } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">帳號管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          只有超級管理員能新增帳號。一般使用者登入後可以自己改密碼與顯示名稱。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">新增帳號</h2>
        <CreateUserForm roles={roles} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">顯示名稱</th>
              <th className="px-5 py-3">帳號</th>
              <th className="px-5 py-3">角色</th>
              <th className="px-5 py-3">狀態</th>
              <th className="px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="flex items-center gap-2.5 px-5 py-3 font-medium text-slate-800">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                    <IconUsers className="h-3.5 w-3.5" />
                  </span>
                  {u.displayName}
                </td>
                <td className="px-5 py-3 text-slate-500">{u.username}</td>
                <td className="px-5 py-3 text-slate-500">{u.role.name}</td>
                <td className="px-5 py-3">
                  <form action={toggleUserActiveAction.bind(null, u.id)}>
                    <button
                      type="submit"
                      className={`rounded-full px-2 py-0.5 text-xs font-medium transition ${
                        u.isActive
                          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      {u.isActive ? "啟用中" : "已停用"}
                    </button>
                  </form>
                </td>
                <td className="px-5 py-3">
                  <ResetPasswordForm userId={u.id} />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">
                  尚未建立任何帳號
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
