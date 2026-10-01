"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { getRunResultsAction, type OptimizeActionResult, type RunResultView } from "./actions";
import { IconAlertTriangle, IconCheckCircle, IconKey, IconX } from "@/components/icons";
import { AI_MODELS, modelCostUsd } from "@/lib/aiModels";

// 自動優化頁面（任務／版本分頁）共用的元件

export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

// 公司有沒有設定自動換 token（client_id／client_secret）：有的話可以貼 refresh token
export const CanRefreshContext = createContext(false);

// refresh token 是加密過的 JWE（5 段），access token 是 JWT（3 段）
export function isRefreshToken(token: string) {
  return cleanToken(token).split(".").length === 5;
}

// 跟後端 cleanTokenInput 一樣：去掉 Bearer、前後引號與所有空白
export function cleanToken(raw: string): string {
  return raw
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, "");
}

export function tokenMinutesLeft(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? Math.floor((payload.exp * 1000 - Date.now()) / 60000) : null;
  } catch {
    return null;
  }
}

// 這間公司最近實際的平均 token 數（每次呼叫）；沒有紀錄時是 null，改用下面的公式估。
// 用 token 數而不是金額：切換模型時用新模型的單價重算。
export type TokenAverage = { input: number; output: number };
export type UsageStats = { judge: TokenAverage | null; revise: TokenAverage | null };

export const USD_TO_TWD = 32;

export type PlanEstimate = {
  questionsPerRun: number;
  // 時間（分鐘）：刪除舊版＋上傳＋學習等待、問機器人（每題約 45 秒、同時 3 題）、AI 修改
  uploadMinutes: number;
  testMinutes: number;
  reviseMinutes: number;
  runMinutes: number;
  maxMinutes: number;
  // Claude 費用（美元）
  judgeUnitUsd: number;
  judgeRunUsd: number;
  reviseUsd: number;
  similarUsd: number;
  maxUsd: number;
  measured: { judge: boolean; revise: boolean };
};

export function estimatePlan(params: {
  originals: number;
  similarCount: number;
  maxRuns: number;
  contentCount: number;
  contentKind: "FAQ" | "DOC";
  stats: UsageStats;
  judgeModel: string;
  reviseModel: string;
  similarModel: string;
  // 呼叫學習 API 後至少等幾分鐘
  learnWaitMinutes: number;
  // 從某個版本繼續：題目沿用、不產生相似題；起點版本測過就不用先測一輪
  skipSimilar?: boolean;
}): PlanEstimate {
  const { originals, similarCount, maxRuns, contentCount, contentKind, stats } = params;
  const questionsPerRun = originals * (1 + similarCount);
  // 刪除舊版約 2 分＋上傳約 1 分＋學習：呼叫學習後至少等設定的分鐘數（實測學習約 2.5 分，取較長者）
  const uploadMinutes = 3 + Math.max(3, params.learnWaitMinutes);
  const testMinutes = Math.ceil((Math.ceil(questionsPerRun / 3) * 45) / 60);
  const reviseMinutes = 3;
  const runMinutes = uploadMinutes + testMinutes + reviseMinutes;

  // AI 比對一題：比對規則＋題目＋標準答案＋機器人回答約 900 token，輸出判定與原因約 80 token
  const judgeTokens = stats.judge ?? { input: 900, output: 80 };
  const judgeUnitUsd = modelCostUsd(params.judgeModel, judgeTokens.input, judgeTokens.output);
  // AI 修改一次：原始文件（約 15k）＋目前 md＋答錯清單（假設 4 成答錯、每題約 250 token）；輸出整份 md＋思考約 6k
  const mdTokens = contentCount * (contentKind === "DOC" ? 800 : 200);
  const reviseTokens = stats.revise ?? { input: 15_000 + mdTokens + questionsPerRun * 0.4 * 250, output: mdTokens + 6_000 };
  const reviseUsd = modelCostUsd(params.reviseModel, reviseTokens.input, reviseTokens.output);
  // 相似題只在開始時產生一次：輸入每題約 250 token，輸出每個相似問法約 40 token
  const similarUsd =
    similarCount > 0 && !params.skipSimilar ? modelCostUsd(params.similarModel, originals * 250, originals * similarCount * 40) : 0;

  return {
    questionsPerRun,
    uploadMinutes,
    testMinutes,
    reviseMinutes,
    runMinutes,
    // 最後一輪測完就結束，不會再修改
    maxMinutes: runMinutes * maxRuns - reviseMinutes,
    judgeUnitUsd,
    judgeRunUsd: questionsPerRun * judgeUnitUsd,
    reviseUsd,
    similarUsd,
    maxUsd: questionsPerRun * judgeUnitUsd * maxRuns + reviseUsd * (maxRuns - 1) + similarUsd,
    measured: { judge: stats.judge !== null, revise: stats.revise !== null },
  };
}

export function formatMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  return m < 60 ? `${m} 分` : `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ""}`;
}

export function formatTwd(usdValue: number): string {
  const twd = usdValue * USD_TO_TWD;
  return `NT$ ${twd < 1 ? twd.toFixed(2) : twd < 10 ? twd.toFixed(1) : Math.round(twd)}`;
}

export const UsageStatsContext = createContext<UsageStats>({ judge: null, revise: null });

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
  const minutesLeft = value && !refresh ? tokenMinutesLeft(cleanToken(value)) : null;
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
          ? "貼 refresh token 時系統會自動換新的 access token，跑再久都不會因過期暫停；貼 access token 則過期時自動暫停，貼新的就從中斷的地方繼續。取得 refresh token 建議：開無痕視窗登入 → F12 複製 → 立刻關掉無痕視窗（不要按登出），每支只貼一次。"
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
  const left = tokenMinutesLeft(cleanToken(token));
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
  const [filter, setFilter] = useState<"unanswered" | "mismatch" | "match" | "all">("mismatch");
  useEffect(() => {
    getRunResultsAction(versionId).then(setResults);
  }, [versionId]);
  const all = results ?? [];
  const matched = all.filter((r) => r.verdict === "MATCH");
  const mismatched = all.filter((r) => r.verdict === "MISMATCH");
  // 未回答：機器人沒回答、逾時，或 AI 比對失敗（沒有判定結果）
  const unanswered = all.filter((r) => r.verdict !== "MATCH" && r.verdict !== "MISMATCH");
  const shown = filter === "unanswered" ? unanswered : filter === "mismatch" ? mismatched : filter === "match" ? matched : all;
  const emptyText =
    all.length === 0
      ? "這一輪還沒有測試結果。"
      : filter === "unanswered"
        ? "沒有未回答的題目。"
        : filter === "mismatch"
          ? "沒有不一致的題目。"
          : "這一輪沒有答對的題目。";
  const count = (list: RunResultView[]) => (results ? String(list.length) : "");
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Choice
          value={filter}
          onChange={setFilter}
          options={[
            { value: "unanswered", label: "未回答", hint: count(unanswered) },
            { value: "mismatch", label: "不一致", hint: count(mismatched) },
            { value: "match", label: "一致", hint: count(matched) },
            { value: "all", label: "全部", hint: count(all) },
          ]}
        />
      </div>
      {results === null ? (
        <p className="text-xs text-slate-500">載入中…</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <div key={r.order} className="rounded-lg border border-slate-200 p-3 text-xs">
              <div className="flex items-start gap-2">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${
                    r.verdict === "MATCH"
                      ? "bg-emerald-50 text-emerald-700"
                      : r.verdict === "MISMATCH"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {r.verdict === "MATCH" ? "一致" : r.verdict === "MISMATCH" ? "不一致" : "未回答"}
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


// ---------------- 開始表單的版面元件（步驟由上到下排列） ----------------

export function Step({
  no,
  title,
  desc,
  children,
  last,
}: {
  no: number;
  title: string;
  desc?: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-4">
      {!last && <span aria-hidden className="absolute bottom-0 left-4 top-10 w-px bg-gradient-to-b from-teal-200 to-slate-100" />}
      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-600 to-cyan-500 text-sm font-semibold text-white shadow-sm shadow-teal-500/30 ring-4 ring-white">
        {no}
      </span>
      <div className={`min-w-0 flex-1 pt-1 ${last ? "" : "pb-8"}`}>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>}
        <div className="mt-3">{children}</div>
      </div>
    </li>
  );
}

// 單選卡片：一張卡一個選項，選中的有外框與勾選點
export function OptionCards<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; desc: string; badge?: string; disabled?: boolean }[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`group flex items-start gap-3 rounded-xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? "border-teal-400 bg-teal-50/60 ring-4 ring-teal-100" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                active ? "border-teal-600 bg-teal-600" : "border-slate-300 bg-white"
              }`}
            >
              {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${active ? "text-teal-900" : "text-slate-800"}`}>{o.label}</span>
                {o.badge && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-500"}`}>
                    {o.badge}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">{o.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// 數字欄位：單位放在輸入框裡
export function StepperField({
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
  suffix: string;
}) {
  return (
    <label className="block rounded-xl border border-slate-200 bg-white p-3.5">
      <span className="block text-xs font-semibold text-slate-700">{label}</span>
      <span className="mt-2 flex items-center rounded-lg border border-slate-300 shadow-sm focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-l-lg border-0 bg-transparent px-3 py-2 text-sm tabular-nums focus:outline-none"
        />
        <span className="pr-3 text-xs text-slate-400">{suffix}</span>
      </span>
      <span className="mt-1.5 block text-[11px] leading-snug text-slate-400">{hint}</span>
    </label>
  );
}

// 一個 AI 步驟一列：左邊說明、右邊選模型與即時費用
export function ModelRow({
  title,
  desc,
  value,
  onChange,
  cost,
}: {
  title: string;
  desc: string;
  value: string;
  onChange: (v: string) => void;
  cost: string;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{desc}</p>
      </div>
      <div className="flex items-center gap-3 sm:w-80">
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${title}的模型`} className={`${inputClass} flex-1`}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}（{m.hint}）
            </option>
          ))}
        </select>
        <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800">{cost}</span>
      </div>
    </div>
  );
}

// 費用摘要的一格數字
export function SummaryStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/80 px-4 py-3 ring-1 ring-inset ring-slate-200">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
