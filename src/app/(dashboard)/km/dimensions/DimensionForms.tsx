"use client";

import { useActionState } from "react";
import { createDimensionAction, type DimensionActionState } from "./actions";
import { IconCheckCircle, IconAlertTriangle, IconPlus } from "@/components/icons";

const initialState: DimensionActionState = {};

export function CreateDimensionForm() {
  const [state, formAction, pending] = useActionState(createDimensionAction, initialState);
  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">維度名稱</label>
          <input name="name" type="text" required placeholder="例如：活動日期" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">說明（選填）</label>
          <input name="description" type="text" placeholder="提示 AI 這個維度該關注什麼" className={inputClass} />
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
        {pending ? "建立中…" : "新增維度"}
      </button>
    </form>
  );
}
