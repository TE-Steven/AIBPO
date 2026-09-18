"use client";

import { useActionState } from "react";
import { createAgentAction, type AgentActionState } from "./actions";
import { IconAlertTriangle, IconPlus } from "@/components/icons";

const initialState: AgentActionState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export function AgentCreateForm() {
  const [state, formAction, pending] = useActionState(createAgentAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">名稱</label>
        <input name="name" type="text" required placeholder="例如：客服報修助手" className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">系統提示詞（定義這個 Agent 的角色與行為）</label>
        <textarea
          name="systemPrompt"
          required
          rows={3}
          placeholder="例如：你是產品客服助手，負責協助顧客查詢維修進度、辦理退換貨。請全程使用繁體中文回覆。"
          className={inputClass}
        />
      </div>
      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-100">
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
        {pending ? "建立中…" : "新增 Agent"}
      </button>
    </form>
  );
}
