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
  // 超級管理員不碰任何租戶業務資料（proxy.ts 也會擋），側欄不顯示這些連結，避免點了又被彈回去。
  const navItems: NavItem[] =
    session.kind === "superadmin"
      ? []
      : allMenus
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

  // 超級管理員是平台維運角色，不碰租戶業務資料，側欄只留平台總覽跟全站共用的選單管理。
  const systemItems: NavItem[] =
    session.kind === "superadmin"
      ? [
          { href: "/platform/companies", label: "平台總覽", icon: "menu-list" },
          { href: "/settings/menus", label: "選單管理", icon: "menu-list" },
        ]
      : session.isCompanyAdmin
        ? [
            { href: "/settings/users", label: "帳號管理", icon: "users" },
            { href: "/settings/roles", label: "角色管理", icon: "shield-check" },
            { href: "/settings/prompts", label: "Prompt管理", icon: "sparkles" },
          ]
        : [];

  const roleLabel = session.kind === "superadmin" ? "超級管理員" : session.roleName;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between bg-gradient-to-r from-teal-800 to-cyan-500 px-4 py-3 lg:px-6">
        <Logo size="sm" variant="light" />
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-teal-50 sm:inline">
            {session.displayName}
            <span className="text-teal-200">（{roleLabel}）</span>
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/90 transition hover:bg-white/10"
            >
              <IconLogout className="h-4 w-4" />
              <span className="hidden sm:inline">登出</span>
            </button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 側欄固定不隨右側內容捲動；自己的選單太長時用自己的 overflow-y-auto 捲，不是整頁一起滾。 */}
        <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white pt-4 lg:flex">
          <AdminNav items={navItems} />

          {systemItems.length > 0 && (
            <>
              <p className="mt-6 px-6 text-xs font-semibold tracking-wide text-slate-400">系統管理</p>
              <div className="mt-2">
                <AdminNav items={systemItems} chipClassName="bg-slate-100 text-slate-500" />
              </div>
            </>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-6 py-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
