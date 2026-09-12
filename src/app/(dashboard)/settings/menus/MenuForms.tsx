"use client";

import { useActionState, useTransition } from "react";
import { createMenuAction, toggleRoleMenuAction, type MenuActionState } from "./actions";
import { IconCheckCircle, IconAlertTriangle, IconPlus } from "@/components/icons";

const initialState: MenuActionState = {};

const ICON_OPTIONS = [
  { value: "dashboard", label: "儀表板" },
  { value: "users", label: "使用者群組" },
  { value: "user-circle", label: "個人" },
  { value: "shield-check", label: "盾牌勾勾" },
  { value: "menu-list", label: "清單" },
  { value: "sparkles", label: "AI 星芒" },
];

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export function CreateMenuForm({ parentOptions }: { parentOptions: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(createMenuAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">識別碼（key）</label>
          <input name="key" type="text" required placeholder="例如 km-new" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">顯示名稱</label>
          <input name="label" type="text" required placeholder="例如 新增KM" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">路徑（群組標題可留空）</label>
          <input name="path" type="text" placeholder="/km/new" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">圖示</label>
          <select name="icon" className={inputClass} defaultValue="dashboard">
            {ICON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:w-1/2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">上層選單</label>
          <select name="parentId" className={inputClass} defaultValue="">
            <option value="">無（頂層）</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">排序</label>
          <input name="order" type="number" defaultValue={0} className={inputClass} />
        </div>
      </div>
      {(state.success || state.error) && (
        <p
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
            state.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
          }`}
        >
          {state.error ? <IconAlertTriangle className="h-4 w-4 shrink-0" /> : <IconCheckCircle className="h-4 w-4 shrink-0" />}
          {state.error ?? state.success}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
      >
        <IconPlus className="h-4 w-4" />
        {pending ? "建立中…" : "新增選單"}
      </button>
    </form>
  );
}

export function PermissionCheckbox({
  roleId,
  menuId,
  defaultChecked,
}: {
  roleId: string;
  menuId: string;
  defaultChecked: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <input
      type="checkbox"
      defaultChecked={defaultChecked}
      disabled={isPending}
      onChange={(e) => {
        const checked = e.target.checked;
        startTransition(async () => {
          await toggleRoleMenuAction(roleId, menuId, checked);
        });
      }}
      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400 disabled:opacity-50"
    />
  );
}
