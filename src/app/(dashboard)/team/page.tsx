import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { IconUsers } from "@/components/icons";

export default async function TeamPage() {
  const session = await requireSession();

  // 資料權限示範：一般使用者只查得到「同角色」的人；superadmin 的 roleScope() 回傳空條件，不受限制。
  const users = await prisma.user.findMany({
    where: roleScope(session),
    include: { role: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">團隊成員</h1>
        <p className="mt-1 text-sm text-slate-500">
          {session.kind === "superadmin"
            ? "超級管理員可以看到所有角色的成員。"
            : `你目前是「${session.roleName}」角色，這裡只會看到同角色的成員。`}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">顯示名稱</th>
              <th className="px-5 py-3">帳號</th>
              <th className="px-5 py-3">角色</th>
              <th className="px-5 py-3">狀態</th>
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
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.isActive ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {u.isActive ? "啟用中" : "已停用"}
                  </span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">
                  目前沒有成員資料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
