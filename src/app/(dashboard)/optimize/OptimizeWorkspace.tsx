"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startOptimizationAction,
  stopOptimizationAction,
  resumeOptimizationAction,
  deleteOptimizationJobAction,
  deployVersionAction,
  clearBackendAction,
  getRunResultsAction,
  type OptimizeActionResult,
  type RunResultView,
} from "./actions";
import { LocalTime } from "@/components/LocalTime";
import { IconAlertTriangle, IconCheckCircle, IconKey, IconSparkles, IconTrash, IconX } from "@/components/icons";

export type SourceOption = { id: string; title: string; faq: number; doc: number; confirmedFaq: number; confirmedDoc: number };

export type RunView = {
  versionId: string;
  name: string;
  runIndex: number;
  scoreAll: number | null;
  scoreOriginal: number | null;
  scoreSimilar: number | null;
  inBackend: boolean;
  testStatus: string | null;
  testTotal: number;
  testCompleted: number;
};

export type JobView = {
  id: string;
  label: string;
  scope: string;
  contentKind: string;
  questionSource: string;
  maxRuns: number;
  targetScore: number;
  similarCount: number;
  stallRuns: number;
  status: string;
  currentRun: number;
  currentStep: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  createdAt: string;
  originalCount: number;
  similarTotal: number;
  runs: RunView[];
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

const STATUS: Record<string, { label: string; className: string }> = {
  RUNNING: { label: "執行中", className: "bg-teal-50 text-teal-700 ring-teal-200" },
  PAUSED_TOKEN: { label: "暫停：需要新 token", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  DONE: { label: "完成", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  STOPPED: { label: "已停止", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  FAILED: { label: "發生錯誤", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};

// 公司有沒有設定自動換 token（client_id／client_secret）：有的話可以貼 refresh token
const CanRefreshContext = createContext(false);

// refresh token 是加密過的 JWE（5 段），access token 是 JWT（3 段）
function isRefreshToken(token: string) {
  return token.trim().replace(/^Bearer\s+/i, "").split(".").length === 5;
}

function tokenMinutesLeft(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? Math.floor((payload.exp * 1000 - Date.now()) / 60000) : null;
  } catch {
    return null;
  }
}

// 粗估：後台學習約 5 分鐘（依後台而定）＋每題約 45 秒、同時 3 題＋AI 修改約 3 分鐘
function estimateRunMinutes(questionTotal: number) {
  return 5 + Math.ceil((Math.ceil(questionTotal / 3) * 45) / 60) + 3;
}
// 粗估 Claude 費用（美元）：每題 AI 比對約 $0.004、每輪 AI 修改整份 md 約 $0.25
function estimateRunUsd(questionTotal: number) {
  return questionTotal * 0.004 + 0.25;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
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

function TokenField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

function useTokenUsable(token: string) {
  const canRefresh = useContext(CanRefreshContext);
  if (!token.trim()) return false;
  if (isRefreshToken(token)) return canRefresh;
  const left = tokenMinutesLeft(token.trim().replace(/^Bearer\s+/i, ""));
  return left === null || left > 0;
}

function Feedback({ result }: { result: OptimizeActionResult | null }) {
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
function TokenActionModal({
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

function NumberField({
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

function Choice<T extends string>({
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

function StartForm({ sources, testCaseCount, onDone }: { sources: SourceOption[]; testCaseCount: number; onDone: () => void }) {
  const [scope, setScope] = useState<"SOURCE" | "KNOWLEDGE">("SOURCE");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [knowledgeSourceId, setKnowledgeSourceId] = useState("");
  const [contentKind, setContentKind] = useState<"FAQ" | "DOC">("FAQ");
  const [questionSource, setQuestionSource] = useState<"ENTRIES" | "TEST_BANK">("ENTRIES");
  const [maxRuns, setMaxRuns] = useState(5);
  const [targetScore, setTargetScore] = useState(90);
  const [similarCount, setSimilarCount] = useState(1);
  const [stallRuns, setStallRuns] = useState(2);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const scoped =
    scope === "SOURCE"
      ? sources.filter((s) => s.id === sourceId).map((s) => ({ faq: s.faq, doc: s.doc }))
      : sources.filter((s) => !knowledgeSourceId || s.id === knowledgeSourceId).map((s) => ({ faq: s.confirmedFaq, doc: s.confirmedDoc }));
  const faqCount = scoped.reduce((n, s) => n + s.faq, 0);
  const docCount = scoped.reduce((n, s) => n + s.doc, 0);
  const contentCount = contentKind === "DOC" ? docCount : faqCount;
  const questionCount = questionSource === "TEST_BANK" ? testCaseCount : faqCount;
  const questionTotal = questionCount * (1 + similarCount);
  const runMinutes = estimateRunMinutes(questionTotal);
  const totalTwd = Math.round((estimateRunUsd(questionTotal) * maxRuns + 0.05) * 32);
  const usable = useTokenUsable(token);
  const ready = contentCount > 0 && questionCount > 0 && usable;

  function start() {
    setResult(null);
    startTransition(async () => {
      const r = await startOptimizationAction({
        scope,
        sourceId: scope === "SOURCE" ? sourceId : knowledgeSourceId,
        contentKind,
        questionSource,
        maxRuns,
        targetScore,
        similarCount,
        stallRuns,
        token,
      });
      setResult(r);
      if (r.success) {
        setToken("");
        onDone();
      }
    });
  }

  return (
    <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-700">1. 範圍</p>
        <Choice
          value={scope}
          onChange={setScope}
          options={[
            { value: "SOURCE", label: "KM 來源", hint: "一個來源的全部題目" },
            { value: "KNOWLEDGE", label: "知識列表", hint: "已加入知識列表的題目" },
          ]}
        />
        {scope === "SOURCE" ? (
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="KM 來源" className={inputClass}>
            {sources.length === 0 && <option value="">（還沒有來源）</option>}
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}（FAQ {s.faq}・結構化 {s.doc}）
              </option>
            ))}
          </select>
        ) : (
          <select value={knowledgeSourceId} onChange={(e) => setKnowledgeSourceId(e.target.value)} aria-label="篩選來源" className={inputClass}>
            <option value="">全部來源</option>
            {sources
              .filter((s) => s.confirmedFaq + s.confirmedDoc > 0)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}（FAQ {s.confirmedFaq}・結構化 {s.confirmedDoc}）
                </option>
              ))}
          </select>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">2. 上傳到後台的內容</p>
          <Choice
            value={contentKind}
            onChange={setContentKind}
            options={[
              { value: "FAQ", label: "FAQ", hint: `${faqCount} 題` },
              { value: "DOC", label: "結構化文件", hint: `${docCount} 份` },
            ]}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">3. 測試題目</p>
          <Choice
            value={questionSource}
            onChange={setQuestionSource}
            options={[
              { value: "ENTRIES", label: "範圍內的 FAQ", hint: `${faqCount} 題` },
              { value: "TEST_BANK", label: "測試題庫", hint: `${testCaseCount} 題` },
            ]}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-slate-700">4. 參數</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="最多跑幾輪" hint="1–10 輪" value={maxRuns} onChange={setMaxRuns} min={1} max={10} suffix="輪" />
          <NumberField label="目標正確率" hint="達到就停止" value={targetScore} onChange={setTargetScore} min={1} max={100} suffix="%" />
          <NumberField label="每題相似題" hint="同一個標準答案、換個問法，0–5" value={similarCount} onChange={setSimilarCount} min={0} max={5} suffix="題" />
          <NumberField label="連續沒進步就停" hint="比最佳一輪沒進步幾輪" value={stallRuns} onChange={setStallRuns} min={1} max={10} suffix="輪" />
        </div>
      </div>

      <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        每輪問 {questionCount} 題 × {1 + similarCount} = <span className="font-semibold">{questionTotal}</span> 題，一輪約 {runMinutes} 分鐘（後台學習時間另計）；
        跑滿 {maxRuns} 輪最多約 {runMinutes * maxRuns} 分鐘、Claude 費用約 NT$ {totalTwd}。
        <br />
        每一輪上傳前會先刪除 AIBPO 上一次上傳到後台的知識（只刪 AIBPO 記下的那批，後台原有的知識不會動）。
      </div>

      <TokenField value={token} onChange={setToken} />
      <Feedback result={result} />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={start}
          disabled={pending || !ready}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
        >
          <IconSparkles className="h-4 w-4" />
          {pending ? "啟動中…" : "開始自動優化"}
        </button>
      </div>
    </div>
  );
}

function ScoreBar({ value, target }: { value: number | null; target: number }) {
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

function ResultsModal({ run, onClose }: { run: RunView; onClose: () => void }) {
  const [results, setResults] = useState<RunResultView[] | null>(null);
  const [filter, setFilter] = useState<"wrong" | "all">("wrong");
  useEffect(() => {
    getRunResultsAction(run.versionId).then(setResults);
  }, [run.versionId]);
  const shown = (results ?? []).filter((r) => filter === "all" || r.verdict !== "MATCH");
  return (
    <Modal title={`第 ${run.runIndex} 輪逐題結果`} onClose={onClose} wide>
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

function JobCard({ job }: { job: JobView }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | { kind: "resume" } | { kind: "deploy"; run: RunView } | { kind: "results"; run: RunView }>(null);
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const status = STATUS[job.status] ?? STATUS.FAILED;
  const active = job.status === "RUNNING" || job.status === "PAUSED_TOKEN";
  const scored = job.runs.filter((r) => r.scoreAll !== null);
  const best = scored.reduce<RunView | null>((a, b) => (!a || (b.scoreAll ?? 0) > (a.scoreAll ?? 0) ? b : a), null);
  const current = job.runs.find((r) => r.runIndex === job.currentRun);
  const testing = job.status === "RUNNING" && current?.testStatus === "RUNNING";

  function run(action: () => Promise<OptimizeActionResult>) {
    setResult(null);
    startTransition(async () => {
      setResult(await action());
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{job.label}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${status.className}`}>{status.label}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            <LocalTime iso={job.createdAt} />・{job.contentKind === "DOC" ? "結構化文件" : "FAQ"}・題目：
            {job.questionSource === "TEST_BANK" ? "測試題庫" : "範圍內 FAQ"} {job.originalCount} 題＋相似題 {job.similarTotal} 題・目標 {job.targetScore}%・最多{" "}
            {job.maxRuns} 輪・連續 {job.stallRuns} 輪沒進步就停
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(job.status === "PAUSED_TOKEN" || job.status === "FAILED") && (
            <button
              type="button"
              onClick={() => setModal({ kind: "resume" })}
              className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
            >
              貼 token 繼續
            </button>
          )}
          {active && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => stopOptimizationAction(job.id))}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 disabled:opacity-50"
            >
              停止
            </button>
          )}
          {!active && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm("刪除這個任務紀錄？各輪版本仍會保留在知識列表的「版本」分頁。")) run(() => deleteOptimizationJobAction(job.id));
              }}
              aria-label="刪除任務"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-rose-600 disabled:opacity-50"
            >
              <IconTrash className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {(job.currentStep || job.stopReason) && (
        <p className="mt-3 text-xs text-slate-600">
          {job.status === "RUNNING" && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-teal-500" />}
          {job.currentStep}
          {testing && current && `　${current.testCompleted} / ${current.testTotal}`}
        </p>
      )}
      {job.errorMessage && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {job.errorMessage}
        </p>
      )}
      <div className="mt-2">
        <Feedback result={result} />
      </div>

      {job.runs.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-400">
                <th className="w-14 py-1.5 font-medium">輪次</th>
                <th className="py-1.5 font-medium">正確率（全部）</th>
                <th className="w-20 py-1.5 text-right font-medium">原題</th>
                <th className="w-20 py-1.5 text-right font-medium">相似題</th>
                <th className="w-64 py-1.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {job.runs.map((r) => (
                <tr key={r.versionId}>
                  <td className="py-2 font-medium text-slate-700">
                    r{r.runIndex}
                    {best?.versionId === r.versionId && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700">最佳</span>}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <ScoreBar value={r.scoreAll} target={job.targetScore} />
                      <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-slate-800">
                        {r.scoreAll !== null ? `${r.scoreAll}%` : "—"}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-600">{r.scoreOriginal !== null ? `${r.scoreOriginal}%` : "—"}</td>
                  <td className="py-2 text-right tabular-nums text-slate-600">{r.scoreSimilar !== null ? `${r.scoreSimilar}%` : "—"}</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {r.inBackend && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">在後台</span>}
                      {r.testTotal > 0 && (
                        <button type="button" onClick={() => setModal({ kind: "results", run: r })} className="text-teal-700 hover:underline">
                          逐題結果
                        </button>
                      )}
                      <a href={`/api/km/versions/${r.versionId}/download`} className="text-teal-700 hover:underline">
                        下載 md
                      </a>
                      {!active && !r.inBackend && (
                        <button type="button" onClick={() => setModal({ kind: "deploy", run: r })} className="font-semibold text-teal-700 hover:underline">
                          部署到後台
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === "resume" && (
        <TokenActionModal
          title="貼新的 token 繼續"
          description={<>會從中斷的那一步繼續（{job.currentStep ?? "目前步驟"}）。</>}
          confirmLabel="繼續執行"
          onSubmit={async (token) => {
            const r = await resumeOptimizationAction(job.id, token);
            router.refresh();
            return r;
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "deploy" && (
        <TokenActionModal
          title={`部署第 ${modal.run.runIndex} 輪到後台`}
          description={
            <>
              會先刪除 AIBPO 先前上傳到後台的知識（只刪 AIBPO 記下的那批），再上傳「{modal.run.name}」並送出學習。學習完成後機器人就會用這一版回答。
            </>
          }
          confirmLabel="部署"
          onSubmit={async (token) => {
            const r = await deployVersionAction(modal.run.versionId, token);
            router.refresh();
            return r;
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "results" && <ResultsModal run={modal.run} onClose={() => setModal(null)} />}
    </div>
  );
}

export function OptimizeWorkspace(props: WorkspaceProps) {
  return (
    <CanRefreshContext.Provider value={props.canRefresh}>
      <Workspace {...props} />
    </CanRefreshContext.Provider>
  );
}

type WorkspaceProps = {
  targetReady: boolean;
  canRefresh: boolean;
  sources: SourceOption[];
  testCaseCount: number;
  jobs: JobView[];
  deployedVersion: { id: string; name: string } | null;
};

function Workspace({
  targetReady,
  sources,
  testCaseCount,
  jobs,
  deployedVersion,
}: WorkspaceProps) {
  const router = useRouter();
  const hasActive = jobs.some((j) => j.status === "RUNNING" || j.status === "PAUSED_TOKEN");
  const hasRunning = jobs.some((j) => j.status === "RUNNING");
  const [showForm, setShowForm] = useState(!hasActive && jobs.length === 0);
  const [clearing, setClearing] = useState(false);

  // 有任務在跑就每 5 秒更新一次進度
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [hasRunning, router]);

  if (!targetReady) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-100">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        這間公司還沒設定機器人測試 API 或知識庫 platformId，請聯絡平台管理員到「平台總覽 → 公司設定」補上後再使用。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          目前後台的 AIBPO 版本：
          <span className="font-semibold text-slate-700">{deployedVersion ? deployedVersion.name : "沒有"}</span>
          {deployedVersion && !hasActive && (
            <button type="button" onClick={() => setClearing(true)} className="ml-2 text-rose-600 hover:underline">
              從後台移除
            </button>
          )}
        </p>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            disabled={hasActive}
            title={hasActive ? "同一間公司一次只能跑一個自動優化" : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            <IconSparkles className="h-4 w-4" />
            新的自動優化
          </button>
        )}
      </div>

      {showForm && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">新的自動優化</h2>
            {jobs.length > 0 && (
              <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-500 hover:text-slate-700">
                收起
              </button>
            )}
          </div>
          {hasActive ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">已經有進行中（或暫停中）的自動優化，請先等它跑完或停止。</p>
          ) : (
            <StartForm
              sources={sources}
              testCaseCount={testCaseCount}
              onDone={() => {
                setShowForm(false);
                router.refresh();
              }}
            />
          )}
        </div>
      )}

      {jobs.length === 0 ? (
        !showForm && <p className="text-sm text-slate-500">還沒有自動優化紀錄。</p>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      {clearing && (
        <TokenActionModal
          title="從後台移除 AIBPO 上傳的知識"
          description={<>只會刪除 AIBPO 上傳時記下的知識（目前是「{deployedVersion?.name}」），後台原有的知識不會動。</>}
          confirmLabel="移除"
          onSubmit={async (token) => {
            const r = await clearBackendAction(token);
            router.refresh();
            return r;
          }}
          onClose={() => setClearing(false)}
        />
      )}
    </div>
  );
}
