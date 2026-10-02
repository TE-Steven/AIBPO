"use client";

import { useActionState, useState } from "react";
import { saveBotTestTargetAction, type BotTestTargetActionState } from "./actions";
import type { BotProfile, BotTestSettings } from "@/lib/botTest";
import { IconCheckCircle, IconAlertTriangle, IconPlus, IconTrash } from "@/components/icons";

const initialState: BotTestTargetActionState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

function newBot(index: number, from?: BotProfile): BotProfile {
  return {
    id: `bot-${Date.now().toString(36)}-${index}`,
    name: `機器人 ${index + 1}`,
    description: "",
    workflowBaseUrl: from?.workflowBaseUrl ?? "https://uat.telligentbiz.com",
    gatewayBaseUrl: from?.gatewayBaseUrl ?? "https://gw-uat.telligentbiz.com",
    platformId: "",
  };
}

function BotCard({
  bot,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  bot: BotProfile;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<BotProfile>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">
          <span className="mr-1.5 text-slate-400">#{index + 1}</span>
          {bot.name || "（未命名）"}
        </p>
        {canRemove && (
          <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline">
            <IconTrash className="h-3.5 w-3.5" />
            刪除這隻機器人
          </button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">名稱</label>
          <input value={bot.name} onChange={(e) => onChange({ name: e.target.value })} required placeholder="例：追覓官網客服" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">說明（選填）</label>
          <input value={bot.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="例：UAT 環境、只有掃地機產品" className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">送題 API 網址</label>
          <input type="url" value={bot.workflowBaseUrl} onChange={(e) => onChange({ workflowBaseUrl: e.target.value })} required className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">會打 {"{網址}"}/workflowapi/api/workflow/chat/start</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">取答案 API 網址（Gateway）</label>
          <input type="url" value={bot.gatewayBaseUrl} onChange={(e) => onChange({ gatewayBaseUrl: e.target.value })} required className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">會打 {"{網址}"}/{"{companyCode}"}/communication/api/v1/customer/unreading</p>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Channel（platformId）</label>
          <input value={bot.platformId} onChange={(e) => onChange({ platformId: e.target.value })} required className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">要問的機器人所在的 channel ID。</p>
        </div>
      </div>
    </div>
  );
}

export function BotTestTargetForm({
  companyId,
  settings,
  hasClientSecret,
}: {
  companyId: string;
  // client_secret 不會送到瀏覽器
  settings: Omit<BotTestSettings, "clientSecret">;
  hasClientSecret: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveBotTestTargetAction, initialState);
  const [bots, setBots] = useState<BotProfile[]>(settings.bots.length > 0 ? settings.bots : [newBot(0)]);

  function update(i: number, patch: Partial<BotProfile>) {
    setBots((cur) => cur.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="bots" value={JSON.stringify(bots)} />

      <div className="space-y-3">
        {bots.map((bot, i) => (
          <BotCard
            key={bot.id}
            bot={bot}
            index={i}
            canRemove={bots.length > 1}
            onChange={(patch) => update(i, patch)}
            onRemove={() => {
              if (confirm(`刪除「${bot.name}」？已經用它測過的紀錄會保留。`)) setBots((cur) => cur.filter((_, j) => j !== i));
            }}
          />
        ))}
        <button
          type="button"
          onClick={() => setBots((cur) => [...cur, newBot(cur.length, cur[cur.length - 1])])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
        >
          <IconPlus className="h-3.5 w-3.5" />
          新增一隻機器人
        </button>
      </div>

      <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-sm font-semibold text-slate-800">共用設定</p>
          <p className="mt-0.5 text-xs text-slate-400">以下設定所有機器人共用；自動優化的 md 一律上傳到同一個知識庫。</p>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">知識庫 platformId（自動優化用）</label>
          <input name="knowledgePlatformId" type="text" defaultValue={settings.knowledgePlatformId} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">自動優化把 md 上傳到這個知識庫（生成式知識）；沒填就不能使用自動優化。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">上傳檔案路徑</label>
          <input name="uploadPath" type="text" defaultValue={settings.uploadPath} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">接在取答案網址（Gateway）後面；{"{code}"} 會換成 token 的公司代碼。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">知識庫 API 路徑</label>
          <input name="knowledgePath" type="text" defaultValue={settings.knowledgePath} className={inputClass} />
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
            defaultValue={settings.tokenUrl}
            placeholder={`${bots[0]?.workflowBaseUrl ?? "https://uat.telligentbiz.com"}/oauth2api/connect/token`}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-400">留空就用第一隻機器人的 {"{送題網址}"}/oauth2api/connect/token。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">client_id</label>
          <input name="clientId" type="text" autoComplete="off" defaultValue={settings.clientId} className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">client_secret</label>
          <input name="clientSecret" type="password" autoComplete="new-password" placeholder={hasClientSecret ? "已設定（留空＝不變）" : ""} className={inputClass} />
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
            defaultValue={settings.tokenCompanyId}
            placeholder="例：97010d74-4852-11f1-962f-00ff95512fa4"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-400">換 token 時要一起帶的公司 ID（token 裡的 company）。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">company_code</label>
          <input name="tokenCompanyCode" type="text" autoComplete="off" defaultValue={settings.tokenCompanyCode} placeholder="例：edenred" className={inputClass} />
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
