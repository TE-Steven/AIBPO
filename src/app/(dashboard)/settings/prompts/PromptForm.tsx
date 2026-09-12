"use client";

import { useActionState } from "react";
import { saveKmGuidelinesAction, type PromptActionState } from "./actions";
import { IconCheckCircle, IconAlertTriangle } from "@/components/icons";

const initialState: PromptActionState = {};

export function PromptForm({ defaultValue }: { defaultValue: string }) {
  const [state, formAction, pending] = useActionState(saveKmGuidelinesAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <textarea
        name="guidelines"
        rows={10}
        defaultValue={defaultValue}
        placeholder={
          "例如：\n- 如果文件內容沒有直接回答某個問題，就不要產生這一題，不要用「請洽客服」「請至XX頁面查詢」這種沒有實質內容的答案來湊數\n- 答案一律使用繁體中文\n- 不要在答案裡出現「根據文件」「文件中提到」這類贅詞，直接講重點"
        }
        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
      />
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
        {pending ? "儲存中…" : "儲存準則"}
      </button>
    </form>
  );
}
