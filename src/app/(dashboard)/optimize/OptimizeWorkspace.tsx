"use client";

import { useContext, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startOptimizationAction,
  stopOptimizationAction,
  resumeOptimizationAction,
  deleteOptimizationJobAction,
  deployVersionAction,
  clearBackendAction,
  type OptimizeActionResult,
} from "./actions";
import {
  CanRefreshContext,
  estimatePlan,
  Feedback,
  formatMinutes,
  formatTwd,
  inputClass,
  ModelRow,
  OptionCards,
  ResultsModal,
  ScoreBar,
  Step,
  StepperField,
  SummaryStat,
  TokenActionModal,
  TokenField,
  UsageStatsContext,
  useTokenUsable,
  type UsageStats,
} from "./optimizeShared";
import { DEFAULT_AI_MODEL } from "@/lib/aiModels";
import { CompareModal, ContinueModal, type ContinueBase } from "./versionModals";
import { LocalTime } from "@/components/LocalTime";
import { IconAlertTriangle, IconChevronDown, IconSparkles, IconTrash, IconX } from "@/components/icons";

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
  tested: boolean;
  entryCount: number;
};

export type JobView = {
  id: string;
  seq: number;
  baseVersionName: string | null;
  models: string;
  judgeModel: string;
  reviseModel: string;
  learnWaitMinutes: number;
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

const STATUS: Record<string, { label: string; className: string }> = {
  RUNNING: { label: "執行中", className: "bg-teal-50 text-teal-700 ring-teal-200" },
  PAUSED_TOKEN: { label: "暫停：需要新 token", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  DONE: { label: "完成", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  STOPPED: { label: "已停止", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  FAILED: { label: "發生錯誤", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};

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
  const [learnWaitMinutes, setLearnWaitMinutes] = useState(5);
  const [judgeModel, setJudgeModel] = useState(DEFAULT_AI_MODEL);
  const [reviseModel, setReviseModel] = useState(DEFAULT_AI_MODEL);
  const [similarModel, setSimilarModel] = useState(DEFAULT_AI_MODEL);
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
  const stats = useContext(UsageStatsContext);
  const plan = estimatePlan({ originals: questionCount, similarCount, maxRuns, contentCount, contentKind, stats, judgeModel, reviseModel, similarModel, learnWaitMinutes });
  const usable = useTokenUsable(token);
  const ready = contentCount > 0 && questionCount > 0 && usable;
  const measuredNote = plan.measured.judge || plan.measured.revise ? "依這間公司最近的實際用量估算" : "預估值";

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
        learnWaitMinutes,
        judgeModel,
        reviseModel,
        similarModel,
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <ol className="p-6">
        <Step no={1} title="範圍" desc="要優化哪些 KM 內容。">
          <OptionCards
            value={scope}
            onChange={setScope}
            options={[
              { value: "SOURCE", label: "KM 來源", desc: "一個來源的全部題目與結構化文件" },
              { value: "KNOWLEDGE", label: "知識列表", desc: "已加入知識列表的題目，可再篩來源" },
            ]}
          />
          <div className="mt-3">
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
        </Step>

        <Step no={2} title="上傳到後台的內容" desc="每一輪會把這份內容（AI 修改後的版本）上傳到後台知識庫讓機器人學習。">
          <OptionCards
            value={contentKind}
            onChange={setContentKind}
            options={[
              { value: "FAQ", label: "FAQ", desc: "整份問答合成一個 md 檔", badge: `${faqCount} 題` },
              { value: "DOC", label: "結構化文件", desc: "一份文件一個 md 檔，各自上傳", badge: `${docCount} 份` },
            ]}
          />
        </Step>

        <Step no={3} title="測試題目" desc="每一輪用這些題目問機器人，再請 AI 比對答案算正確率。">
          <OptionCards
            value={questionSource}
            onChange={setQuestionSource}
            options={[
              { value: "ENTRIES", label: "範圍內的 FAQ", desc: "用範圍內 FAQ 的題目與答案", badge: `${faqCount} 題` },
              { value: "TEST_BANK", label: "測試題庫", desc: "用知識列表的固定測試題庫", badge: `${testCaseCount} 題` },
            ]}
          />
        </Step>

        <Step no={4} title="參數" desc="什麼時候停、每題要多問幾種說法。">
          <div className="grid gap-3 sm:grid-cols-2">
            <StepperField label="最多跑幾輪" hint="1–10 輪，跑滿就停" value={maxRuns} onChange={setMaxRuns} min={1} max={10} suffix="輪" />
            <StepperField label="目標正確率" hint="任何一輪達到就停" value={targetScore} onChange={setTargetScore} min={1} max={100} suffix="%" />
            <StepperField
              label="每題相似題"
              hint="同一個標準答案、換個問法，看機器人是不是只會背原題（0–5）"
              value={similarCount}
              onChange={setSimilarCount}
              min={0}
              max={5}
              suffix="題"
            />
            <StepperField label="連續沒進步就停" hint="比最佳的一輪連續幾輪沒進步" value={stallRuns} onChange={setStallRuns} min={1} max={10} suffix="輪" />
            <StepperField
              label="呼叫學習後至少等"
              hint="呼叫後台學習 API 後至少等這麼久才開始問，同時也會等後台顯示學習完成（0–30 分）"
              value={learnWaitMinutes}
              onChange={setLearnWaitMinutes}
              min={0}
              max={30}
              suffix="分鐘"
            />
          </div>
        </Step>

        <Step no={5} title="AI 模型" desc="三個用到 Claude 的地方各自選模型，右邊的費用會即時重算。">
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            <ModelRow
              title="比對答案"
              desc={`機器人每回答一題比對一次，每輪 ${plan.questionsPerRun} 次（每題約 ${formatTwd(plan.judgeUnitUsd)}）`}
              value={judgeModel}
              onChange={setJudgeModel}
              cost={`${formatTwd(plan.judgeRunUsd)}／輪`}
            />
            <ModelRow
              title="修改 md"
              desc="依答錯的題目修改整份 md，每輪一次（最後一輪不改）"
              value={reviseModel}
              onChange={setReviseModel}
              cost={`${formatTwd(plan.reviseUsd)}／次`}
            />
            <ModelRow
              title="產生相似題"
              desc={similarCount > 0 ? `開始時產生一次，共 ${questionCount * similarCount} 題` : "相似題設為 0，不會用到"}
              value={similarModel}
              onChange={setSimilarModel}
              cost={similarCount > 0 ? formatTwd(plan.similarUsd) : "—"}
            />
          </div>
        </Step>

        <Step no={6} title="Access token" desc="用來呼叫後台知識庫與機器人的 API。" last>
          <TokenField value={token} onChange={setToken} />
        </Step>
      </ol>

      <div className="border-t border-slate-200 bg-gradient-to-br from-slate-50 to-teal-50/40 p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">預估</h3>
          <span className="text-[11px] text-slate-400">{measuredNote}</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryStat label="每輪題數" value={`${plan.questionsPerRun} 題`} sub={`${questionCount} 題 ×（1＋${similarCount} 相似題）`} />
          <SummaryStat label="一輪時間" value={formatMinutes(plan.runMinutes)} sub={`問機器人約 ${formatMinutes(plan.testMinutes)}`} />
          <SummaryStat label={`跑滿 ${maxRuns} 輪最多`} value={formatMinutes(plan.maxMinutes)} sub="達標或沒進步會提早停" />
          <SummaryStat label="Claude 費用最多" value={formatTwd(plan.maxUsd)} sub={`比對 ${maxRuns} 輪＋修改 ${Math.max(0, maxRuns - 1)} 次`} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          一輪時間＝刪除舊版＋上傳＋學習等待約 {plan.uploadMinutes} 分＋問機器人＋AI 修改約 {plan.reviseMinutes} 分，時間幾乎都花在等機器人回答。每一輪上傳前會先刪除
          AIBPO 上一次上傳到後台的知識（只刪 AIBPO 記下的那批，後台原有的知識不會動）。
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <div className="mr-auto">
            <Feedback result={result} />
          </div>
          <button
            type="button"
            onClick={start}
            disabled={pending || !ready}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
          >
            <IconSparkles className="h-4 w-4" />
            {pending ? "啟動中…" : "開始自動優化"}
          </button>
        </div>
      </div>
    </div>
  );
}

function JobCard({
  job,
  hasActive,
  selected,
  onToggleSelect,
  defaultOpen,
}: {
  job: JobView;
  hasActive: boolean;
  selected: string[];
  onToggleSelect: (versionId: string) => void;
  defaultOpen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [modal, setModal] = useState<
    null | { kind: "resume" } | { kind: "deploy"; run: RunView } | { kind: "results"; run: RunView } | { kind: "continue"; run: RunView }
  >(null);
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

  function continueBase(r: RunView): ContinueBase {
    return {
      id: r.versionId,
      name: r.name,
      targetScore: job.targetScore,
      tested: r.tested,
      scoreAll: r.scoreAll,
      questionsPerRun: job.originalCount + job.similarTotal,
      entryCount: r.entryCount,
      contentKind: job.contentKind,
      judgeModel: job.judgeModel,
      reviseModel: job.reviseModel,
      learnWaitMinutes: job.learnWaitMinutes,
    };
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="group min-w-0 flex-1 text-left" aria-expanded={open}>
          <div className="flex flex-wrap items-center gap-2">
            <IconChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "" : "-rotate-90"}`} />
            <h3 className="text-sm font-semibold text-slate-900 group-hover:text-teal-700">
              <span className="mr-1.5 text-slate-400">#{job.seq}</span>
              {job.label}
            </h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${status.className}`}>{status.label}</span>
            {job.baseVersionName && <span className="text-[11px] text-slate-500">從 {job.baseVersionName} 繼續</span>}
            {best && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                最佳 {best.name.split("・")[0]}・{best.scoreAll}%
              </span>
            )}
            <span className="text-[11px] text-slate-400">{job.runs.length} 個版本</span>
          </div>
          <p className="mt-1 pl-6 text-xs text-slate-500">
            <LocalTime iso={job.createdAt} />・{job.contentKind === "DOC" ? "結構化文件" : "FAQ"}・題目：
            {job.questionSource === "TEST_BANK" ? "測試題庫" : "範圍內 FAQ"} {job.originalCount} 題＋相似題 {job.similarTotal} 題・目標 {job.targetScore}%・最多{" "}
            {job.maxRuns} 輪・連續 {job.stallRuns} 輪沒進步就停・呼叫學習後至少等 {job.learnWaitMinutes} 分・{job.models}
          </p>
        </button>
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

      {(job.currentStep || job.errorMessage || result) && (
        <div className="space-y-2 px-5 pb-4">
          {job.currentStep && (
            <p className="text-xs text-slate-600">
              {job.status === "RUNNING" && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-teal-500" />}
              {job.currentStep}
              {testing && current && `　${current.testCompleted} / ${current.testTotal}`}
            </p>
          )}
          {job.errorMessage && (
            <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {job.errorMessage}
            </p>
          )}
          <Feedback result={result} />
        </div>
      )}

      {open && job.runs.length > 0 && (
        <div className="overflow-x-auto border-t border-slate-100 bg-slate-50/50">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-400">
                <th className="w-10 py-2 pl-5" />
                <th className="w-40 py-2 font-medium">版本</th>
                <th className="py-2 font-medium">正確率（全部）</th>
                <th className="w-16 py-2 text-right font-medium">原題</th>
                <th className="w-16 py-2 text-right font-medium">相似題</th>
                <th className="w-80 py-2 pr-5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {job.runs.map((r) => (
                <tr key={r.versionId} className={selected.includes(r.versionId) ? "bg-teal-50/60" : "bg-white"}>
                  <td className="py-2.5 pl-5">
                    <input
                      type="checkbox"
                      checked={selected.includes(r.versionId)}
                      onChange={() => onToggleSelect(r.versionId)}
                      aria-label={`選擇 ${r.name} 來比較`}
                    />
                  </td>
                  <td className="py-2.5 font-medium text-slate-700">
                    {r.name.split("・")[0]}
                    {best?.versionId === r.versionId && <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] text-amber-700">最佳</span>}
                    {r.inBackend && <span className="ml-1.5 rounded bg-teal-50 px-1.5 text-[10px] font-semibold text-teal-700">在後台</span>}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <ScoreBar value={r.scoreAll} target={job.targetScore} />
                      <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-slate-800">
                        {r.scoreAll !== null ? `${r.scoreAll}%` : "—"}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-slate-600">{r.scoreOriginal !== null ? `${r.scoreOriginal}%` : "—"}</td>
                  <td className="py-2.5 text-right tabular-nums text-slate-600">{r.scoreSimilar !== null ? `${r.scoreSimilar}%` : "—"}</td>
                  <td className="py-2.5 pr-5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {r.testTotal > 0 && (
                        <button type="button" onClick={() => setModal({ kind: "results", run: r })} className="text-teal-700 hover:underline">
                          逐題結果
                        </button>
                      )}
                      <a href={`/api/km/versions/${r.versionId}/download`} className="text-teal-700 hover:underline">
                        下載 md
                      </a>
                      {!hasActive && (
                        <button type="button" onClick={() => setModal({ kind: "continue", run: r })} className="text-teal-700 hover:underline">
                          從這版繼續
                        </button>
                      )}
                      {!hasActive && !r.inBackend && (
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
          title={`部署 ${modal.run.name} 到後台`}
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
      {modal?.kind === "results" && (
        <ResultsModal versionId={modal.run.versionId} title={`${modal.run.name} 逐題結果`} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "continue" && <ContinueModal base={continueBase(modal.run)} onClose={() => setModal(null)} />}
    </div>
  );
}

export function OptimizeWorkspace(props: WorkspaceProps) {
  return (
    <CanRefreshContext.Provider value={props.canRefresh}>
      <UsageStatsContext.Provider value={props.usageStats}>
        <Workspace {...props} />
      </UsageStatsContext.Provider>
    </CanRefreshContext.Provider>
  );
}

type WorkspaceProps = {
  targetReady: boolean;
  canRefresh: boolean;
  usageStats: UsageStats;
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
  // 版本比較：可以跨任務勾選（從某版繼續的任務，起點版本在另一個任務裡）
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState<[string, string] | null>(null);
  const runsById = new Map(jobs.flatMap((j) => j.runs.map((r) => [r.versionId, { ...r, createdAt: j.createdAt }] as const)));
  const selectedRuns = selected.map((id) => runsById.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));

  function toggleSelect(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id]));
  }

  function openCompare() {
    if (selectedRuns.length !== 2) return;
    // 舊版在前：先比任務建立時間，同一個任務比輪次
    const [x, y] = [...selectedRuns].sort((p, q) => p.createdAt.localeCompare(q.createdAt) || p.runIndex - q.runIndex);
    setComparing([x.versionId, y.versionId]);
  }

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
          {jobs.map((job, i) => (
            <JobCard
              key={job.id}
              job={job}
              hasActive={hasActive}
              selected={selected}
              onToggleSelect={toggleSelect}
              // 進行中、暫停中或最新的一個任務預設展開，其他收合
              defaultOpen={i === 0 || job.status === "RUNNING" || job.status === "PAUSED_TOKEN"}
            />
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

      {selected.length > 0 && (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-200 bg-white/95 px-5 py-3 shadow-lg shadow-teal-900/10 backdrop-blur">
          <p className="text-xs text-slate-600">
            已選 {selected.length}／2 個版本：
            <span className="font-semibold text-slate-800">{selectedRuns.map((r) => r.name.split("・")[0]).join("、")}</span>
            {selected.length < 2 && <span className="ml-1 text-slate-400">（再勾一個版本就能比較，可以跨任務）</span>}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelected([])} className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700">
              <IconX className="h-3.5 w-3.5" />
              清除
            </button>
            <button
              type="button"
              disabled={selectedRuns.length !== 2}
              onClick={openCompare}
              className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
            >
              比較所選版本
            </button>
          </div>
        </div>
      )}
      {comparing && <CompareModal ids={comparing} onClose={() => setComparing(null)} />}
    </div>
  );
}
