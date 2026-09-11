import { requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { deleteMenuAction } from "./actions";
import { CreateMenuForm, PermissionCheckbox } from "./MenuForms";
import { IconMenuList, IconTrash } from "@/components/icons";

export default async function MenusPage() {
  await requireSuperAdmin();

  const [menus, roles, roleMenus] = await Promise.all([
    prisma.menu.findMany({ orderBy: { order: "asc" } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    prisma.roleMenu.findMany(),
  ]);

  const checkedSet = new Set(roleMenus.map((rm) => `${rm.roleId}:${rm.menuId}`));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">選單管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          新增的選單預設不會顯示給任何角色，要在下方矩陣勾選才會出現在該角色的側欄。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">新增選單</h2>
        <CreateMenuForm />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">選單</th>
              <th className="px-5 py-3">路徑</th>
              <th className="px-5 py-3">排序</th>
              <th className="px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {menus.map((m) => (
              <tr key={m.id}>
                <td className="flex items-center gap-2.5 px-5 py-3 font-medium text-slate-800">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                    <IconMenuList className="h-3.5 w-3.5" />
                  </span>
                  {m.label}
                  <span className="text-xs text-slate-400">{m.key}</span>
                </td>
                <td className="px-5 py-3 text-slate-500">{m.path}</td>
                <td className="px-5 py-3 text-slate-500">{m.order}</td>
                <td className="px-5 py-3">
                  <form action={deleteMenuAction.bind(null, m.id)}>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700"
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                      刪除
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">選單權限矩陣</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            超級管理員永遠看得到所有選單，不受這裡的設定影響。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-5 py-3">選單 \ 角色</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-5 py-3 text-center">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {menus.map((m) => (
                <tr key={m.id}>
                  <td className="px-5 py-3 font-medium text-slate-700">{m.label}</td>
                  {roles.map((r) => (
                    <td key={r.id} className="px-5 py-3 text-center">
                      <PermissionCheckbox
                        roleId={r.id}
                        menuId={m.id}
                        defaultChecked={checkedSet.has(`${r.id}:${m.id}`)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {menus.length === 0 && (
                <tr>
                  <td colSpan={roles.length + 1} className="px-5 py-8 text-center text-sm text-slate-400">
                    尚未建立任何選單
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
