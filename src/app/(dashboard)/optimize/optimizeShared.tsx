"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import {
  getKeyPointsAction,
  getRunResultsAction,
  saveKeyPointsAction,
  saveQuestionNoteAction,
  type OptimizeActionResult,
  type RunResultView,
} from "./actions";
import { POINT_STATUS_LABELS, type JudgeDetail, type KeyPoint, type PointStatus } from "@/lib/keyPoints";
import { IconAlertTriangle, IconCheckCircle, IconKey, IconX } from "@/components/icons";
import { AI_MODELS, findAiModel, modelCostUsd } from "@/lib/aiModels";
import type { BotOption } from "@/lib/botTest";

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
  // 每輪實際問機器人＋比對的次數（含沒答對再問一次）
  askedPerRun: number;
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

// 估算用的假設（跟 src/lib/optimizationRunner.ts 的實際做法對應）
const RETRY_SHARE = 0.35; // 第一次沒答對、要再問一次的比例
const VERIFY_SHARE = 0.2; // 便宜的比對模型判出講錯／矛盾、要 Sonnet 複核的比例
const VERIFY_MODEL = "claude-sonnet-5";
const REVISE_BATCHES = 2;
const REVISE_BATCH_SIZE = 10;

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
  // 第一次沒答對的題目會再問一次（假設約三成五）
  const askedPerRun = questionsPerRun * (1 + RETRY_SHARE);
  // 刪除舊版約 2 分＋上傳約 1 分＋學習：呼叫學習後至少等設定的分鐘數（實測學習約 2.5 分，取較長者）
  const uploadMinutes = 3 + Math.max(3, params.learnWaitMinutes);
  const testMinutes = Math.ceil((Math.ceil(askedPerRun / 3) * 45) / 60);
  // AI 修改一輪分兩批，每批約 3 分
  const reviseMinutes = 3 * REVISE_BATCHES;
  const runMinutes = uploadMinutes + testMinutes + reviseMinutes;

  // AI 比對一題：比對規則＋題目＋完整標準答案＋關鍵答案＋機器人回答約 1,300 token，輸出逐點判定約 300 token
  const judgeTokens = stats.judge ?? { input: 1_300, output: 300 };
  // 比對模型是 Haiku 這類便宜模型時，判出講錯／矛盾的題目（假設約兩成）會再由 Sonnet 複核
  const verifyUsd = findAiModel(params.judgeModel).effort ? 0 : VERIFY_SHARE * modelCostUsd(VERIFY_MODEL, judgeTokens.input, judgeTokens.output);
  const judgeUnitUsd = modelCostUsd(params.judgeModel, judgeTokens.input, judgeTokens.output) + verifyUsd;
  // AI 修改一批：原始文件（約 15k）＋目前 md＋分類說明＋10 題答錯清單；輸出診斷、修改清單與思考約 8k
  const mdTokens = contentCount * (contentKind === "DOC" ? 800 : 200);
  // 原始文件有提示快取：第一批寫入快取（1.25 倍），之後的批次讀快取（0.1 倍）；有實際用量時直接用平均（已含快取效果）
  const sourceTokens = 15_000;
  const restTokens = mdTokens + 1_000 + REVISE_BATCH_SIZE * 400;
  const reviseUsd = stats.revise
    ? modelCostUsd(params.reviseModel, stats.revise.input, stats.revise.output) * REVISE_BATCHES
    : modelCostUsd(params.reviseModel, sourceTokens * 1.25 + restTokens, 8_000) +
      (REVISE_BATCHES - 1) * modelCostUsd(params.reviseModel, sourceTokens * 0.1 + restTokens, 8_000);
  // 相似題只在開始時產生一次：輸入每題約 250 token，輸出每個相似問法約 40 token
  const similarUsd =
    similarCount > 0 && !params.skipSimilar ? modelCostUsd(params.similarModel, originals * 250, originals * similarCount * 40) : 0;

  return {
    questionsPerRun,
    askedPerRun: Math.round(askedPerRun),
    uploadMinutes,
    testMinutes,
    reviseMinutes,
    runMinutes,
    // 最後一輪測完就結束，不會再修改
    maxMinutes: runMinutes * maxRuns - reviseMinutes,
    judgeUnitUsd,
    judgeRunUsd: askedPerRun * judgeUnitUsd,
    reviseUsd,
    similarUsd,
    maxUsd: askedPerRun * judgeUnitUsd * maxRuns + reviseUsd * (maxRuns - 1) + similarUsd,
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

// 目前頁面是 RAG優化還是 FAQ優化（建立任務、版本操作、說明文字依類型切換）
export const OptimizeTypeContext = createContext<"RAG" | "FAQ">("RAG");

// 公司設定的機器人（自動優化問題目用；md 一律上傳到同一個知識庫）
export const BotsContext = createContext<BotOption[]>([]);

export function BotSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const bots = useContext(BotsContext);
  const isFaq = useContext(OptimizeTypeContext) === "FAQ";
  const current = bots.find((b) => b.id === value);
  return (
    <div>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="要問哪一隻機器人" className={inputClass}>
        {bots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-slate-400">
        {current?.description || "（沒有說明）"}・channel {current?.channel}。{isFaq ? "FAQ 一律匯入同一個 FAQ 知識庫" : "md 一律上傳到同一個知識庫"}，這裡只決定問哪一隻機器人。
      </p>
    </div>
  );
}

// 各數據的定義與算法（小 ⓘ 的內容），自動優化各畫面共用
export const TIPS = {
  scoreAll: "正確率（全部）＝（一致＋部分一致）的題數 ÷ 全部題數（原題＋相似題）。第一次沒答對的題目會再問一次，第二次答對就算對。長條上的紅線是目標正確率。",
  scoreOriginal: "只算原題（範圍內的 FAQ 或測試題庫）的正確率，算法跟「全部」一樣。",
  scoreSimilar: "只算 AI 產生的相似問法。相似題不給 AI 修改 md 時看，只用來驗收：原題高、相似題低，代表機器人可能只會背原題的問法。",
  coverage: "涵蓋率＝每題講到的關鍵答案比例（必要與次要都算，講錯算沒講到），再取全部題目的平均；沒回答算 0%。正確率沒變時，看涵蓋率可以知道部分一致的題目有沒有在進步。",
  best: "這個任務正確率（全部）最高的版本，同分時涵蓋率高的優先。AI 每一輪都從最佳版本開始修改，部署時也建議選它。",
  verdicts: "一致：必要的關鍵答案都講到，沒講錯、沒矛盾。部分一致：沒講錯，但必要點沒講全（正確率算對，仍會拿去修改）。不一致：任何一點講錯、多講且跟標準答案矛盾，或完全沒講到。未回答：機器人逾時、出錯，或 AI 比對失敗。",
  questionCoverage: "這一題講到的關鍵答案比例（必要與次要都算，講錯算沒講到）。",
  keyPoints: "標準答案拆成的重點，每個標準答案只拆一次，原題和相似題共用。必要：一定要講到；次要：可以不講，但講了不能錯。可以按「編輯關鍵答案」調整，下一次比對生效。",
  questionsPerRun: "原題數 ×（1＋每題相似題數）。每一輪都問同一套題目，分數才能比較。",
  runTime: "刪除後台上一版＋上傳＋學習等待＋問機器人（每題約 45 秒、同時 3 題，含沒答對再問一次）＋AI 修改兩批。實際時間依機器人回答速度而定。",
  maxTime: "一輪時間 × 最多輪數（最後一輪測完就結束、不再修改）。達到目標或連續沒進步會提早停。",
  maxCost: "比對（含沒答對重問；選 Haiku 時含 Sonnet 複核）× 輪數 ＋ 修改兩批 ×（輪數－1）＋ 相似題。有過去的實際用量時，用平均 token 數估算。",
  compareChange: "比較兩個版本同一題的結果：從不一致／未回答變成一致或部分一致＝變對；反過來＝變錯；兩版都沒答對＝仍錯。",
  mdGrowth: "這一版 md 的字數比起點版本多（＋）或少（－）幾成。一直往上長要留意，太長可能讓機器人更難找到內容。",
  editsApplied: "AI 提出的修改項目中，實際套用到 md 的數量。沒套用的會標原因：定位不到（引用的原文在 md 裡找不到），或違反分類結構（想新增、改名或刪除分類層級的標題）。",
  diagnoses: "這一輪 AI 處理的題目（最多 20 題，分兩批各 10 題）與它判斷的答錯原因。",
  runTimeFaq: "匯入 FAQ（覆蓋全部）＋等後台處理匯入約 1 分鐘＋呼叫學習後的等待＋問機器人（每題約 45 秒、同時 3 題，含沒答對再問一次）＋AI 修改兩批。實際時間依機器人回答速度而定。",
  maxCostFaq: "比對（含沒答對重問；選 Haiku 時含 Sonnet 複核）× 輪數 ＋ 修改 FAQ 兩批 ×（輪數－1）＋ 開始時擴充 FAQ 相似句與產生測試用相似題。有過去的實際用量時，用平均 token 數估算。",
} as const;

// 數據旁邊的小 ⓘ：滑鼠移上去或點一下顯示定義與算法。用 fixed 定位，放在可捲動的表格裡也不會被切掉
export function InfoTip({ children, label = "這是什麼？" }: { children: React.ReactNode; label?: string }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const width = Math.min(288, typeof window === "undefined" ? 288 : window.innerWidth - 16);
  function show(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    // 下方空間不夠就顯示在上方
    setPos(r.bottom + 180 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  }
  return (
    <span className="inline-flex align-middle" onMouseLeave={() => setPos(null)}>
      <button
        type="button"
        aria-label={label}
        onMouseEnter={(e) => show(e.currentTarget)}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => setPos(null)}
        onClick={(e) => {
          // 點擊一律顯示（滑鼠移開或點別的地方才關閉）；手機沒有 hover，靠點擊打開
          e.stopPropagation();
          show(e.currentTarget);
        }}
        className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-teal-600 focus:text-teal-600 focus:outline-none"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      {pos && (
        <span
          role="tooltip"
          style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width }}
          className="z-[60] whitespace-normal rounded-lg bg-slate-800 px-3 py-2 text-left text-[11px] font-normal leading-relaxed text-white shadow-xl"
        >
          {children}
        </span>
      )}
    </span>
  );
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

const VERDICT_BADGE: Record<string, { label: string; className: string }> = {
  MATCH: { label: "一致", className: "bg-emerald-50 text-emerald-700" },
  PARTIAL: { label: "部分一致", className: "bg-amber-50 text-amber-700" },
  MISMATCH: { label: "不一致", className: "bg-rose-50 text-rose-700" },
};

const POINT_STYLE: Record<PointStatus, { dot: string; text: string }> = {
  COVERED: { dot: "bg-emerald-500", text: "text-emerald-700" },
  MISSING: { dot: "bg-slate-300", text: "text-slate-500" },
  WRONG: { dot: "bg-rose-500", text: "text-rose-700" },
};

// 編輯某個標準答案的關鍵答案：之後所有用到這個標準答案的比對都會用新的
export function KeyPointsEditor({
  expectedAnswer,
  fallback,
  onClose,
}: {
  expectedAnswer: string;
  fallback: KeyPoint[];
  onClose: () => void;
}) {
  const [points, setPoints] = useState<KeyPoint[] | null>(null);
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getKeyPointsAction(expectedAnswer).then((r) => setPoints(r?.points ?? fallback));
  }, [expectedAnswer, fallback]);

  function update(i: number, patch: Partial<KeyPoint>) {
    setPoints((cur) => (cur ? cur.map((p, j) => (j === i ? { ...p, ...patch } : p)) : cur));
  }

  return (
    <Modal title="編輯關鍵答案" onClose={onClose} wide>
      <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
        <span className="font-semibold text-slate-700">標準答案：</span>
        {expectedAnswer}
      </p>
      <p className="mb-3 text-xs text-slate-500">
        必要的關鍵答案一定要講到；次要的可以不講。任何一點講錯都算不一致。修改後，之後所有用到這個標準答案的比對（包含相似題）都會用新的。
      </p>
      {points === null ? (
        <p className="text-xs text-slate-500">載入中…</p>
      ) : (
        <div className="space-y-2">
          {points.map((p, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <input
                  value={p.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  aria-label={`關鍵答案 ${i + 1}`}
                  className={`${inputClass} flex-1`}
                />
                <label className="flex shrink-0 items-center gap-1.5 pt-2 text-xs text-slate-600">
                  <input type="checkbox" checked={p.required} onChange={(e) => update(i, { required: e.target.checked })} />
                  必要
                </label>
                <button
                  type="button"
                  onClick={() => setPoints((cur) => (cur ? cur.filter((_, j) => j !== i) : cur))}
                  aria-label="刪除這個關鍵答案"
                  className="shrink-0 rounded p-2 text-slate-400 hover:bg-slate-50 hover:text-rose-600"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                value={p.aliases.join("、")}
                onChange={(e) => update(i, { aliases: e.target.value.split(/[、,，]/).map((a) => a.trim()).filter(Boolean) })}
                placeholder="可接受說法，用「、」分隔（例：兩年、24 個月）"
                aria-label={`關鍵答案 ${i + 1} 的可接受說法`}
                className={`${inputClass} mt-2 text-xs`}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPoints((cur) => [...(cur ?? []), { text: "", required: true, aliases: [] }])}
            className="text-xs font-semibold text-teal-700 hover:underline"
          >
            ＋ 新增關鍵答案
          </button>
        </div>
      )}
      <div className="mt-3">
        <Feedback result={result} />
      </div>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700">
          {result?.success ? "關閉" : "取消"}
        </button>
        <button
          type="button"
          disabled={pending || !points}
          onClick={() => startTransition(async () => setResult(await saveKeyPointsAction(expectedAnswer, points ?? [])))}
          className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
        >
          {pending ? "儲存中…" : "儲存"}
        </button>
      </div>
    </Modal>
  );
}

// 一題的關鍵答案逐點結果
export function KeyPointList({ detail }: { detail: JudgeDetail }) {
  return (
    <div className="space-y-1">
      {detail.points.map((p, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${POINT_STYLE[p.status].dot}`} />
          <div className="min-w-0">
            <span className={`mr-1.5 font-semibold ${POINT_STYLE[p.status].text}`}>{POINT_STATUS_LABELS[p.status]}</span>
            <span className={`mr-1.5 rounded px-1 text-[10px] ${p.required ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}>
              {p.required ? "必要" : "次要"}
            </span>
            <span className="text-slate-700">{p.text}</span>
            {p.evidence && <span className="ml-1.5 text-slate-400">← 「{p.evidence}」</span>}
          </div>
        </div>
      ))}
      {detail.conflicts.map((c, i) => (
        <div key={`c${i}`} className="flex items-start gap-2">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
          <p>
            <span className="mr-1.5 font-semibold text-rose-700">多講且矛盾</span>
            <span className="text-slate-700">{c}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

// 題目備註：寫給 AI 下一次修改 md 時參考（存在題目上，換版本也還在）
function QuestionNote({ jobQuestionId, note, onSaved }: { jobQuestionId: string; note: string | null; onSaved: (note: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await saveQuestionNoteAction(jobQuestionId, text);
      if (r.error) {
        setError(r.error);
        return;
      }
      onSaved(text.trim() || null);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div className="mt-2 rounded-lg bg-amber-50/70 p-2.5 ring-1 ring-inset ring-amber-100">
        <p className="mb-1.5 text-[11px] font-semibold text-amber-800">備註（AI 下一次修改 md 時會優先參考）</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="例：保固要講到延長保固的條件；這題其實是問 L380 不是 L600"
          className={`${inputClass} text-xs`}
        />
        {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-3 text-[11px]">
          <button
            type="button"
            onClick={() => {
              setText(note ?? "");
              setEditing(false);
            }}
            className="text-slate-500 hover:text-slate-700"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {pending ? "儲存中…" : "儲存備註"}
          </button>
        </div>
      </div>
    );
  }
  return note ? (
    <div className="mt-2 flex items-start justify-between gap-3 rounded-lg bg-amber-50/70 px-2.5 py-2 ring-1 ring-inset ring-amber-100">
      <p className="whitespace-pre-wrap text-amber-900">
        <span className="mr-1.5 font-semibold">備註：</span>
        {note}
      </p>
      <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-[11px] font-semibold text-amber-700 hover:underline">
        編輯
      </button>
    </div>
  ) : (
    <button type="button" onClick={() => setEditing(true)} className="mt-2 text-[11px] font-semibold text-amber-700 hover:underline">
      ＋ 寫備註給 AI 修改參考
    </button>
  );
}

export function ResultsModal({ versionId, title, onClose }: { versionId: string; title: string; onClose: () => void }) {
  const [results, setResults] = useState<RunResultView[] | null>(null);
  const [filter, setFilter] = useState<"unanswered" | "mismatch" | "partial" | "match" | "all">("mismatch");
  const [editing, setEditing] = useState<RunResultView | null>(null);
  useEffect(() => {
    getRunResultsAction(versionId).then(setResults);
  }, [versionId]);
  const all = results ?? [];
  const matched = all.filter((r) => r.verdict === "MATCH");
  const partial = all.filter((r) => r.verdict === "PARTIAL");
  const mismatched = all.filter((r) => r.verdict === "MISMATCH");
  // 未回答：機器人沒回答、逾時，或 AI 比對失敗（沒有判定結果）
  const unanswered = all.filter((r) => !r.verdict || !VERDICT_BADGE[r.verdict]);
  const shown =
    filter === "unanswered" ? unanswered : filter === "mismatch" ? mismatched : filter === "partial" ? partial : filter === "match" ? matched : all;
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
            { value: "partial", label: "部分一致", hint: count(partial) },
            { value: "match", label: "一致", hint: count(matched) },
            { value: "all", label: "全部", hint: count(all) },
          ]}
        />
        <InfoTip>{TIPS.verdicts}</InfoTip>
      </div>
      {results === null ? (
        <p className="text-xs text-slate-500">載入中…</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-slate-500">{all.length === 0 ? "這一輪還沒有測試結果。" : "沒有這一類的題目。"}</p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const badge = r.verdict ? VERDICT_BADGE[r.verdict] : undefined;
            return (
              <div key={r.order} className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${badge?.className ?? "bg-slate-100 text-slate-600"}`}>
                    {badge?.label ?? "未回答"}
                  </span>
                  {r.isSimilar && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">相似題</span>}
                  <p className="flex-1 font-medium text-slate-800">{r.question}</p>
                  {r.detail && (
                    <span className="inline-flex shrink-0 items-center text-slate-400">
                      涵蓋 {r.detail.coverage}%<InfoTip>{TIPS.questionCoverage}</InfoTip>
                    </span>
                  )}
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
                {r.detail ? (
                  <div className="mt-2 rounded-lg bg-slate-50 p-2.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="flex items-center text-[11px] font-semibold text-slate-400">
                        關鍵答案<InfoTip>{TIPS.keyPoints}</InfoTip>
                      </p>
                      <button type="button" onClick={() => setEditing(r)} className="text-[11px] font-semibold text-teal-700 hover:underline">
                        編輯關鍵答案
                      </button>
                    </div>
                    {(r.detail.retry || r.detail.verifiedBy) && (
                      <div className="mb-1.5 flex flex-wrap gap-1.5 text-[11px]">
                        {r.detail.retry && (
                          <span className="inline-flex items-center rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
                            第二次問才答對（第一次：{VERDICT_BADGE[r.detail.retry.firstVerdict ?? ""]?.label ?? "未回答"}）
                            <InfoTip>第一次沒答對的題目會再問一次，第二次答對就算對。第一次的回答：{r.detail.retry.firstAnswer ?? "（沒有回答）"}</InfoTip>
                          </span>
                        )}
                        {r.detail.verifiedBy && (
                          <span className="inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">
                            Sonnet 複核
                            <InfoTip>比對模型（例如 Haiku）判出講錯或矛盾時，改由 Sonnet 再判一次，這裡顯示的是複核後的結果。</InfoTip>
                          </span>
                        )}
                      </div>
                    )}
                    <KeyPointList detail={r.detail} />
                  </div>
                ) : (
                  r.verdict !== "MATCH" && r.reason && <p className="mt-2 text-rose-600">原因：{r.reason}</p>
                )}
                {r.jobQuestionId && (
                  <QuestionNote
                    jobQuestionId={r.jobQuestionId}
                    note={r.userNote}
                    onSaved={(note) =>
                      setResults((cur) => (cur ? cur.map((x) => (x.jobQuestionId === r.jobQuestionId ? { ...x, userNote: note } : x)) : cur))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <KeyPointsEditor
          expectedAnswer={editing.expectedAnswer}
          fallback={(editing.detail?.points ?? []).map((p) => ({ text: p.text, required: p.required, aliases: [] }))}
          onClose={() => setEditing(null)}
        />
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
export function SummaryStat({ label, value, sub, tip }: { label: string; value: string; sub?: string; tip?: string }) {
  return (
    <div className="rounded-xl bg-white/80 px-4 py-3 ring-1 ring-inset ring-slate-200">
      <p className="flex items-center text-[11px] font-medium text-slate-500">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
