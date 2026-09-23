"use client";

import { useActionState } from "react";
import { createCompanyAction, type CreateCompanyState } from "./actions";
import { IconAlertTriangle, IconPlus } from "@/components/icons";

const initialState: CreateCompanyState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState(createCompanyAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">公司名稱</label>
        <input name="companyName" type="text" required className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">公司管理員帳號</label>
        <input name="username" type="text" required className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">顯示名稱</label>
        <input name="displayName" type="text" required className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">初始密碼</label>
        <input name="password" type="password" required minLength={6} className={inputClass} />
      </div>

      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-600 ring-1 ring-inset ring-rose-100">
          <IconAlertTriangle className="h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
      >
        <IconPlus className="h-4 w-4" />
        {pending ? "建立中…" : "建立公司"}
      </button>
    </form>
  );
}
