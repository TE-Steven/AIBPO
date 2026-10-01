"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { getRunResultsAction, type OptimizeActionResult, type RunResultView } from "./actions";
import { IconAlertTriangle, IconCheckCircle, IconKey, IconX } from "@/components/icons";

// 自動優化頁面（任務／版本分頁）共用的元件

export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

// 公司有沒有設定自動換 token（client_id／client_secret）：有的話可以貼 refresh token
export const CanRefreshContext = createContext(false);

// refresh token 是加密過的 JWE（5 段），access token 是 JWT（3 段）
export function isRefreshToken(token: string) {
  return token.trim().replace(/^Bearer\s+/i, "").split(".").length === 5;
}

export function tokenMinutesLeft(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? Math.floor((payload.exp * 1000 - Date.now()) / 60000) : null;
  } catch {
    return null;
  }
}

// 粗估：後台學習約 5 分鐘（依後台而定）＋每題約 45 秒、同時 3 題＋AI 修改約 3 分鐘
export function estimateRunMinutes(questionTotal: number) {
  return 5 + Math.ceil((Math.ceil(questionTotal / 3) * 45) / 60) + 3;
}
// 粗估 Claude 費用（美元）：每題 AI 比對約 $0.004、每輪 AI 修改整份 md 約 $0.25
export function estimateRunUsd(questionTotal: number) {
  return questionTotal * 0.004 + 0.25;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${wide ? "max-w-4xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="關閉" className="text-slate-400 hover:text-slate-600">
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function TokenField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const canRefresh = useContext(CanRefreshContext);
  const refresh = value.trim() ? isRefreshToken(value) : false;
  const minutesLeft = value && !refresh ? tokenMinutesLeft(value.trim().replace(/^Bearer\s+/i, "")) : null;
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <IconKey className="h-4 w-4 text-teal-600" />
        Access token
      </label>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={canRefresh ? "貼上 refresh token（建議，可自動續期）或 access token" : "貼上 telligent 的 Bearer token"}
        className={inputClass}
      />
      <p className="mt-1.5 text-xs text-slate-400">
        token 只放在伺服器記憶體裡，不會存進資料庫。
        {canRefresh
          ? "貼 refresh token 時系統會自動換新的 access token，跑再久都不會因過期暫停；貼 access token 則過期時自動暫停，貼新的就從中斷的地方繼續。"
          : "過期時任務會自動暫停，貼新的 token 就從中斷的地方繼續。"}
      </p>
      {refresh && (
        <p className={`mt-1 text-xs ${canRefresh ? "text-emerald-700" : "text-rose-600"}`}>
          {canRefresh ? "這是 refresh token：會自動續期。" : "這是 refresh token，但這間公司還沒設定自動換 token，請改貼 access token。"}
        </p>
      )}
      {minutesLeft !== null && (
        <p className={`mt-1 text-xs ${minutesLeft <= 10 ? "text-rose-600" : "text-slate-500"}`}>
          {minutesLeft <= 0 ? "這個 token 已經過期了" : `這個 token 還有約 ${minutesLeft} 分鐘有效`}
        </p>
      )}
    </div>
  );
}

export function useTokenUsable(token: string) {
  const canRefresh = useContext(CanRefreshContext);
  if (!token.trim()) return false;
  if (isRefreshToken(token)) return canRefresh;
  const left = tokenMinutesLeft(token.trim().replace(/^Bearer\s+/i, ""));
  return left === null || left > 0;
}

export function Feedback({ result }: { result: OptimizeActionResult | null }) {
  if (!result) return null;
  return result.error ? (
    <p className="flex items-start gap-1.5 text-xs text-rose-600">
      <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {result.error}
    </p>
  ) : (
    <p className="flex items-start gap-1.5 text-xs text-emerald-700">
      <IconCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {result.success}
    </p>
  );
}

// 需要 token 的動作（繼續、部署、清除後台）共用的視窗
export function TokenActionModal({
  title,
  description,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onSubmit: (token: string) => Promise<OptimizeActionResult>;
  onClose: () => void;
}) {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const usable = useTokenUsable(token);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-4 text-xs leading-relaxed text-slate-600">{description}</div>
      <TokenField value={token} onChange={setToken} />
      <div className="mt-3">
        <Feedback result={result} />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700">
          {result?.success ? "關閉" : "取消"}
        </button>
        {!result?.success && (
          <button
            type="button"
            disabled={pending || !usable}
            onClick={() =>
              startTransition(async () => {
                const r = await onSubmit(token);
                setResult(r);
                if (r.success) setToken("");
              })
            }
            className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {pending ? "處理中…" : confirmLabel}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`${inputClass} w-24`}
        />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </div>
      <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>
    </label>
  );
}

export function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-2 text-left text-xs ring-1 ring-inset transition ${
            value === o.value ? "bg-teal-50 text-teal-800 ring-teal-300" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          <span className="font-semibold">{o.label}</span>
          {o.hint && <span className="ml-1.5 text-slate-400">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function ScoreBar({ value, target }: { value: number | null; target: number }) {
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      {value !== null && (
        <div
          className={`h-full rounded-full ${value >= target ? "bg-emerald-500" : "bg-teal-500"}`}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      )}
      <div className="absolute inset-y-0 w-px bg-rose-400" style={{ left: `${target}%` }} title={`目標 ${target}%`} />
    </div>
  );
}

export function ResultsModal({ versionId, title, onClose }: { versionId: string; title: string; onClose: () => void }) {
  const [results, setResults] = useState<RunResultView[] | null>(null);
  const [filter, setFilter] = useState<"wrong" | "all">("wrong");
  useEffect(() => {
    getRunResultsAction(versionId).then(setResults);
  }, [versionId]);
  const shown = (results ?? []).filter((r) => filter === "all" || r.verdict !== "MATCH");
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Choice
          value={filter}
          onChange={setFilter}
          options={[
            { value: "wrong", label: "只看答錯" },
            { value: "all", label: "全部" },
          ]}
        />
      </div>
      {results === null ? (
        <p className="text-xs text-slate-500">載入中…</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-slate-500">{results.length === 0 ? "這一輪還沒有測試結果。" : "這一輪全部答對。"}</p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <div key={r.order} className="rounded-lg border border-slate-200 p-3 text-xs">
              <div className="flex items-start gap-2">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${
                    r.verdict === "MATCH" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {r.verdict === "MATCH" ? "一致" : r.verdict === "MISMATCH" ? "不一致" : "沒有結果"}
                </span>
                {r.isSimilar && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">相似題</span>}
                <p className="font-medium text-slate-800">{r.question}</p>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">標準答案</p>
                  <p className="whitespace-pre-wrap text-slate-600">{r.expectedAnswer}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">機器人回答</p>
                  <p className="whitespace-pre-wrap text-slate-600">{r.botAnswer ?? "（沒有回答）"}</p>
                </div>
              </div>
              {r.verdict !== "MATCH" && r.reason && <p className="mt-2 text-rose-600">原因：{r.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

