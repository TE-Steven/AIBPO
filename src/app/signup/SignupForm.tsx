"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction, type SignupActionState } from "./actions";
import { IconAlertTriangle } from "@/components/icons";

const initialState: SignupActionState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">公司名稱</label>
        <input name="companyName" type="text" required className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">管理員帳號</label>
        <input name="username" type="text" required className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">顯示名稱</label>
        <input name="displayName" type="text" required className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">密碼</label>
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
        className="w-full rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
      >
        {pending ? "建立中…" : "建立公司並登入"}
      </button>

      <p className="text-center text-xs text-slate-400">
        已經有帳號了？{" "}
        <Link href="/login" className="font-medium text-teal-600 hover:text-teal-700">
          回登入頁
        </Link>
      </p>
    </form>
  );
}
