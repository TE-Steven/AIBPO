"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ComponentType, SVGProps } from "react";
import {
  IconDashboard,
  IconUsers,
  IconUserCircle,
  IconShieldCheck,
  IconMenuList,
  IconChevronDown,
  IconSparkles,
} from "@/components/icons";

const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  dashboard: IconDashboard,
  users: IconUsers,
  "user-circle": IconUserCircle,
  "shield-check": IconShieldCheck,
  "menu-list": IconMenuList,
  sparkles: IconSparkles,
};

export type NavItem = {
  href: string;
  label: string;
  icon?: string | null;
  exact?: boolean;
  children?: NavItem[];
};

function isActive(pathname: string, item: NavItem): boolean {
  if (item.children?.length) {
    return item.children.some((child) => isActive(pathname, child));
  }
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function Leaf({ item, chipClassName }: { item: NavItem; chipClassName: string }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  const Icon = (item.icon && ICONS[item.icon]) || IconDashboard;

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
        active ? "bg-teal-50 text-teal-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${chipClassName}`}>
        <Icon className="h-4 w-4" strokeWidth={active ? 2.1 : 1.8} />
      </span>
      {item.label}
    </Link>
  );
}

function Group({ item, chipClassName }: { item: NavItem; chipClassName: string }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  const [open, setOpen] = useState(true);
  const Icon = (item.icon && ICONS[item.icon]) || IconDashboard;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
          active ? "text-teal-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${chipClassName}`}>
          <Icon className="h-4 w-4" strokeWidth={active ? 2.1 : 1.8} />
        </span>
        <span className="flex-1 text-left">{item.label}</span>
        <IconChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="ml-4 mt-1 space-y-1 border-l border-slate-100 pl-3">
          {item.children!.map((child) => (
            <Leaf key={child.href} item={child} chipClassName={chipClassName} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminNav({
  items,
  chipClassName = "bg-teal-100 text-teal-600",
}: {
  items: NavItem[];
  chipClassName?: string;
}) {
  return (
    <nav className="space-y-1 px-3">
      {items.map((item) =>
        item.children?.length ? (
          <Group key={item.href || item.label} item={item} chipClassName={chipClassName} />
        ) : (
          <Leaf key={item.href} item={item} chipClassName={chipClassName} />
        ),
      )}
    </nav>
  );
}
