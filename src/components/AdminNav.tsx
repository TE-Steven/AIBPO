"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { IconDashboard, IconUsers, IconUserCircle, IconShieldCheck, IconMenuList } from "@/components/icons";

const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  dashboard: IconDashboard,
  users: IconUsers,
  "user-circle": IconUserCircle,
  "shield-check": IconShieldCheck,
  "menu-list": IconMenuList,
};

export type NavItem = {
  href: string;
  label: string;
  icon?: string | null;
  exact?: boolean;
};

export function AdminNav({
  items,
  chipClassName = "bg-violet-100 text-violet-600",
}: {
  items: NavItem[];
  chipClassName?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1 px-3">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = (item.icon && ICONS[item.icon]) || IconDashboard;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
              active
                ? "bg-violet-50 text-violet-700"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${chipClassName}`}
            >
              <Icon className="h-4 w-4" strokeWidth={active ? 2.1 : 1.8} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
