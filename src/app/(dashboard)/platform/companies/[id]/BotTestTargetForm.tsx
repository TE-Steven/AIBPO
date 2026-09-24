"use client";

import { useActionState } from "react";
import { saveBotTestTargetAction, type BotTestTargetActionState } from "./actions";
import type { BotTestTarget } from "@/lib/botTest";
import { IconCheckCircle, IconAlertTriangle } from "@/components/icons";

const initialState: BotTestTargetActionState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export function BotTestTargetForm({ companyId, target }: { companyId: string; target: BotTestTarget }) {
  const [state, formAction, pending] = useActionState(saveBotTestTargetAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">送題 API 網址</label>
          <input name="workflowBaseUrl" type="url" required defaultValue={target.workflowBaseUrl} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">會打 {"{網址}"}/workflowapi/api/workflow/chat/start</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">取答案 API 網址（Gateway）</label>
          <input name="gatewayBaseUrl" type="url" required defaultValue={target.gatewayBaseUrl} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">會打 {"{網址}"}/{"{companyCode}"}/communication/api/v1/customer/unreading</p>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Channel（platformId）</label>
          <input name="platformId" type="text" required defaultValue={target.platformId} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">要測試的機器人所在的 channel ID；公司代碼等資訊會從測試時填的 token 自動帶入。</p>
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
        className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
      >
        {pending ? "儲存中…" : "儲存"}
      </button>
    </form>
  );
}
