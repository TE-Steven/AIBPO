"use client";

import { useActionState, useState } from "react";
import {
  createCompanyMemberAction,
  resetCompanyMemberPasswordAction,
  type CompanyMemberActionState,
} from "./actions";
import { IconCheckCircle, IconAlertTriangle, IconPlus, IconKey } from "@/components/icons";

const initialState: CompanyMemberActionState = {};

function Message({ state }: { state: CompanyMemberActionState }) {
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

export function CreateCompanyMemberForm({ companyId, roles }: { companyId: string; roles: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createCompanyMemberAction, initialState);
  const [dismissed, setDismissed] = useState(false);

  if (state.needsConfirm && !dismissed) {
    const { username, existingDisplayName, roleId } = state.needsConfirm;
    return (
      <div className="space-y-3 rounded-lg bg-amber-50 p-4 ring-1 ring-inset ring-amber-100">
        <p className="text-sm text-amber-800">
          帳號「{username}」已經存在，顯示名稱是「{existingDisplayName}」。
        </p>
        <p className="text-xs text-amber-700">如果這不是你認識的人，請按「取消」換一個帳號名稱。</p>
        <div className="flex flex-wrap items-center gap-3">
          <form action={formAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="username" value={username} />
            <input type="hidden" name="roleId" value={roleId} />
            <input type="hidden" name="confirmed" value="true" />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
            >
              {pending ? "處理中…" : "確認加入既有帳號"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            取消，重新輸入
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={() => setDismissed(false)} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
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
        {pending ? "建立中…" : "新增成員"}
      </button>
    </form>
  );
}

export function ResetCompanyMemberPasswordForm({ companyId, userId }: { companyId: string; userId: string }) {
  const [state, formAction, pending] = useActionState(resetCompanyMemberPasswordAction, initialState);

  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-medium text-slate-500 hover:text-teal-600">
        <IconKey className="h-3.5 w-3.5" />
        重設密碼
      </summary>
      <p className="mt-1.5 text-xs text-amber-600">這個帳號如果同時屬於其他公司，密碼會一起變更。</p>
      <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="companyId" value={companyId} />
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
