"use client";

import { useActionState } from "react";
import { createUserAction, resetUserPasswordAction, type UserActionState } from "./actions";
import { IconCheckCircle, IconAlertTriangle, IconPlus, IconKey } from "@/components/icons";

const initialState: UserActionState = {};

function Message({ state }: { state: UserActionState }) {
  if (!state.success && !state.error) return null;
  const isError = Boolean(state.error);
  return (
    <p
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
        isError ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
      }`}
    >
      {isError ? <IconAlertTriangle className="h-4 w-4 shrink-0" /> : <IconCheckCircle className="h-4 w-4 shrink-0" />}
      {state.error ?? state.success}
    </p>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export function CreateUserForm({ roles }: { roles: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createUserAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">帳號</label>
          <input name="username" type="text" required className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">角色</label>
          <select name="roleId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              請選擇角色
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">顯示名稱</label>
          <input name="displayName" type="text" className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">建立新帳號時才需要；帳號已存在的話會沿用原本的顯示名稱。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">初始密碼</label>
          <input name="password" type="password" minLength={6} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">建立新帳號時才需要；帳號已存在的話會沿用原本的密碼。</p>
        </div>
      </div>
      <Message state={state} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
      >
        <IconPlus className="h-4 w-4" />
        {pending ? "建立中…" : "新增帳號"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(resetUserPasswordAction, initialState);

  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-medium text-slate-500 hover:text-teal-600">
        <IconKey className="h-3.5 w-3.5" />
        重設密碼
      </summary>
      <p className="mt-1.5 text-xs text-amber-600">這個帳號如果同時屬於其他公司，密碼會一起變更。</p>
      <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="userId" value={userId} />
        <input
          name="newPassword"
          type="password"
          required
          minLength={6}
          placeholder="新密碼"
          className="w-40 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "更新中…" : "確認"}
        </button>
        {(state.success || state.error) && (
          <span className={state.error ? "text-xs text-rose-600" : "text-xs text-emerald-600"}>
            {state.error ?? state.success}
          </span>
        )}
      </form>
    </details>
  );
}
