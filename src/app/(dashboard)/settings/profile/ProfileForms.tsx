"use client";

import { useActionState } from "react";
import { updateDisplayNameAction, changePasswordAction, type ProfileActionState } from "./actions";
import { IconCheckCircle, IconAlertTriangle } from "@/components/icons";

const initialState: ProfileActionState = {};

function Message({ state }: { state: ProfileActionState }) {
  if (!state.success && !state.error) return null;
  const isError = Boolean(state.error);
  return (
    <p
      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${
        isError
          ? "bg-rose-50 text-rose-600 ring-rose-100"
          : "bg-emerald-50 text-emerald-600 ring-emerald-100"
      }`}
    >
      {isError ? (
        <IconAlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <IconCheckCircle className="h-4 w-4 shrink-0" />
      )}
      {state.error ?? state.success}
    </p>
  );
}

export function DisplayNameForm({ defaultValue }: { defaultValue: string }) {
  const [state, formAction, pending] = useActionState(updateDisplayNameAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">顯示名稱</label>
        <input
          name="displayName"
          type="text"
          required
          defaultValue={defaultValue}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
        />
      </div>
      <Message state={state} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "更新中…" : "更新名稱"}
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">目前密碼</label>
        <input
          name="currentPassword"
          type="password"
          required
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">新密碼</label>
        <input
          name="newPassword"
          type="password"
          required
          minLength={6}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">確認新密碼</label>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={6}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
        />
      </div>
      <Message state={state} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "更新中…" : "更新密碼"}
      </button>
    </form>
  );
}
