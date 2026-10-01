"use client";

import { useActionState } from "react";
import { saveBotTestTargetAction, type BotTestTargetActionState } from "./actions";
import type { BotTestTarget } from "@/lib/botTest";
import { IconCheckCircle, IconAlertTriangle } from "@/components/icons";

const initialState: BotTestTargetActionState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export function BotTestTargetForm({
  companyId,
  target,
  hasClientSecret,
}: {
  companyId: string;
  target: BotTestTarget;
  hasClientSecret: boolean;
}) {
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
        <div className="sm:col-span-2 border-t border-slate-100 pt-4">
          <p className="text-sm font-semibold text-slate-800">自動優化：知識庫 API</p>
          <p className="mt-0.5 text-xs text-slate-400">「自動優化」會把 md 上傳到這個知識庫、觸發學習、測完再刪除。沒填知識庫 platformId 就不能使用自動優化。</p>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">知識庫 platformId</label>
          <input name="knowledgePlatformId" type="text" defaultValue={target.knowledgePlatformId} placeholder="例：3b27f20f-4918-11f1-a1eb-4201ac1ac022" className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">跟上面聊天用的 channel 不一樣，是知識庫（生成式知識）所在的 platform。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">上傳檔案路徑</label>
          <input name="uploadPath" type="text" defaultValue={target.uploadPath} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">接在取答案網址（Gateway）後面；{"{code}"} 會換成 token 的公司代碼。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">知識庫 API 路徑</label>
          <input name="knowledgePath" type="text" defaultValue={target.knowledgePath} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">新增／列表（/list）／學習（/learn）／刪除（/delete）都接在這個路徑後面。</p>
        </div>
        <div className="sm:col-span-2 border-t border-slate-100 pt-4">
          <p className="text-sm font-semibold text-slate-800">自動換 token（選填）</p>
          <p className="mt-0.5 text-xs text-slate-400">
            五個都填了之後，自動優化可以貼 refresh token：系統會自己換新的 access token，跑很久也不會因為 token 過期而暫停。
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">token 網址</label>
          <input
            name="tokenUrl"
            type="url"
            defaultValue={target.tokenUrl}
            placeholder={`${target.workflowBaseUrl}/oauth2api/connect/token`}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-400">留空就用 {"{送題網址}"}/oauth2api/connect/token。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">client_id</label>
          <input name="clientId" type="text" autoComplete="off" defaultValue={target.clientId} className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">client_secret</label>
          <input
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder={hasClientSecret ? "已設定（留空＝不變）" : ""}
            className={inputClass}
          />
          {hasClientSecret && (
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" name="clearClientSecret" />
              清除已設定的 client_secret
            </label>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">companyId</label>
          <input
            name="tokenCompanyId"
            type="text"
            autoComplete="off"
            defaultValue={target.tokenCompanyId}
            placeholder="例：97010d74-4852-11f1-962f-00ff95512fa4"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-400">換 token 時要一起帶的公司 ID（token 裡的 company）。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">company_code</label>
          <input name="tokenCompanyCode" type="text" autoComplete="off" defaultValue={target.tokenCompanyCode} placeholder="例：edenred" className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">token 裡的 company_code。</p>
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
