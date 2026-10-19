"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { IconAlertTriangle, IconCheckCircle } from "@/components/icons";
import { saveLineCredentialsAction, sendLineTestAction, unbindLineGroupAction, type LineActionResult } from "./lineActions";

// 參數管理 → LINE 通知分頁
export type LineSettingsView = {
  hasSecret: boolean;
  hasToken: boolean;
  webhookUrl: string;
  code: string;
  groups: { groupId: string; name: string | null; boundAt: string }[];
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

function Feedback({ result }: { result: LineActionResult | null }) {
  if (!result) return null;
  return result.error ? (
    <p className="flex items-center gap-1.5 text-sm text-rose-600">
      <IconAlertTriangle className="h-4 w-4 shrink-0" />
      {result.error}
    </p>
  ) : (
    <p className="flex items-center gap-1.5 text-sm text-emerald-600">
      <IconCheckCircle className="h-4 w-4 shrink-0" />
      {result.success}
    </p>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-50"
    >
      {copied ? "已複製" : "複製"}
    </button>
  );
}

function Card({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-50 text-xs text-teal-700 ring-1 ring-inset ring-teal-200">{step}</span>
        {title}
      </h3>
      <div className="space-y-3 text-sm text-slate-600">{children}</div>
    </div>
  );
}

export function LineSettings({ view }: { view: LineSettingsView }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [saveResult, setSaveResult] = useState<LineActionResult | null>(null);
  const [groupResult, setGroupResult] = useState<LineActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const configured = view.hasSecret && view.hasToken;

  const webhookUrl = view.webhookUrl;

  function save() {
    setSaveResult(null);
    startTransition(async () => {
      const r = await saveLineCredentialsAction({ channelSecret: secret, accessToken: token });
      setSaveResult(r);
      if (r.success) {
        setSecret("");
        setToken("");
        router.refresh();
      }
    });
  }

  function groupAction(action: () => Promise<LineActionResult>) {
    setGroupResult(null);
    startTransition(async () => {
      setGroupResult(await action());
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card step={1} title="建立 LINE 機器人並填寫金鑰">
        <p className="text-xs leading-relaxed text-slate-500">
          到 LINE Developers 建立 Messaging API 頻道（官方帳號），在 LINE 官方帳號管理頁開啟「允許機器人加入群組」。Channel secret 在頻道的 Basic settings，Channel access token（long-lived）在 Messaging API 分頁。存好的金鑰不會再顯示，要更換時重新輸入即可。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">
              Channel secret {view.hasSecret && <span className="ml-1 text-emerald-600">（已設定）</span>}
            </span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={view.hasSecret ? "已設定，留空不變" : "32 個英數字"}
              autoComplete="off"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">
              Channel access token {view.hasToken && <span className="ml-1 text-emerald-600">（已設定）</span>}
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={view.hasToken ? "已設定，留空不變" : "long-lived token"}
              autoComplete="off"
              className={inputClass}
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Feedback result={saveResult} />
          <button
            type="button"
            disabled={pending || (!secret.trim() && !token.trim())}
            onClick={save}
            className="ml-auto rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            儲存金鑰
          </button>
        </div>
      </Card>

      <Card step={2} title="設定 Webhook 網址">
        <p className="text-xs text-slate-500">
          把這個網址貼到 LINE Developers → Messaging API → Webhook URL，並開啟「Use webhook」。可以按「Verify」測試（要先儲存金鑰）。
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">{webhookUrl}</code>
          <CopyButton text={webhookUrl} />
        </div>
      </Card>

      <Card step={3} title="把機器人拉進群組並綁定">
        <p className="text-xs text-slate-500">把機器人加為好友、拉進要接收通知的 LINE 群組，在群組裡傳送這組綁定碼，機器人回覆「已綁定」就完成。要停止通知，在群組傳「解除綁定」或在下面解除。</p>
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-base font-semibold tracking-wider text-slate-800">{view.code}</code>
          <CopyButton text={view.code} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-700">已綁定的群組</p>
          {view.groups.length === 0 ? (
            <p className="text-xs text-slate-400">還沒有綁定任何群組。</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {view.groups.map((g) => (
                <div key={g.groupId} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-slate-700">{g.name ?? "（LINE 群組）"}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    <LocalTime iso={g.boundAt} /> 綁定
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => groupAction(() => unbindLineGroupAction(g.groupId))}
                    className="shrink-0 rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    解除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Feedback result={groupResult} />
          <button
            type="button"
            disabled={pending || !configured || view.groups.length === 0}
            onClick={() => groupAction(sendLineTestAction)}
            className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-50 disabled:opacity-50"
          >
            發送測試通知
          </button>
        </div>
      </Card>

      <p className="text-xs leading-relaxed text-slate-400">
        通知時機：自動優化完成、失敗、暫停等 token、被停止。LINE 發到群組的訊息依群組人數計算則數，免費方案每月有則數上限。
      </p>
    </div>
  );
}
