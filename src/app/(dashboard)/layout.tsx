import type { ReactNode } from "react";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Logo";
import { AdminNav, type NavItem } from "@/components/AdminNav";
import { logoutAction } from "../login/actions";
import { IconLogout } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  const allMenus = await prisma.menu.findMany({ orderBy: { order: "asc" } });
  const isVisible = (key: string) => session.menuKeys === null || session.menuKeys.includes(key);

  const childrenByParent = new Map<string, typeof allMenus>();
  for (const m of allMenus) {
    if (!m.parentId) continue;
    const arr = childrenByParent.get(m.parentId) ?? [];
    arr.push(m);
    childrenByParent.set(m.parentId, arr);
  }

  // 父層群組本身不需要單獨的選單權限：只要底下任一子選單這個角色看得到，群組就顯示。
  const navItems: NavItem[] = allMenus
    .filter((m) => !m.parentId)
    .map((m): NavItem | null => {
      const children = childrenByParent.get(m.id) ?? [];
      if (children.length > 0) {
        const visibleChildren = children
          .filter((c) => isVisible(c.key))
          .map((c) => ({ href: c.path, label: c.label, icon: c.icon, exact: c.path === "/" }));
        if (visibleChildren.length === 0) return null;
        return { href: m.path, label: m.label, icon: m.icon, children: visibleChildren };
      }
      if (!isVisible(m.key)) return null;
      return { href: m.path, label: m.label, icon: m.icon, exact: m.path === "/" };
    })
    .filter((item): item is NavItem => item !== null);

  const systemItems: NavItem[] =
    session.kind === "superadmin"
      ? [
          { href: "/settings/users", label: "帳號管理", icon: "users" },
          { href: "/settings/roles", label: "角色管理", icon: "shield-check" },
          { href: "/settings/menus", label: "選單管理", icon: "menu-list" },
        ]
      : [];

  const roleLabel = session.kind === "superadmin" ? "超級管理員" : session.roleName;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="px-5 py-5">
          <Logo size="sm" subtitle={roleLabel} />
        </div>

        <AdminNav items={navItems} />

        {systemItems.length > 0 && (
          <>
            <p className="mt-6 px-6 text-xs font-semibold tracking-wide text-slate-400">系統管理</p>
            <div className="mt-2">
              <AdminNav items={systemItems} chipClassName="bg-slate-100 text-slate-500" />
            </div>
          </>
        )}

        <div className="mt-auto space-y-1 border-t border-slate-100 p-3">
          <div className="px-2.5 py-1.5 text-xs text-slate-400">
            登入身分：{session.displayName}
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
            >
              <IconLogout className="h-[18px] w-[18px]" />
              登出
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur lg:hidden">
          <Logo size="sm" />
          <form action={logoutAction}>
            <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500">
              <IconLogout className="h-4 w-4" />
              登出
            </button>
          </form>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
