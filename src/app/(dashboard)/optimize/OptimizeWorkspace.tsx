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
  Choice,
  estimatePlan,
  formatMinutes,
  formatTwd,
  UsageStatsContext,
  type UsageStats,
  Feedback,
  inputClass,
  NumberField,
  ResultsModal,
  ScoreBar,
  TokenActionModal,
  TokenField,
  useTokenUsable,
} from "./optimizeShared";
import { VersionsTab, type OptVersionView } from "./VersionsTab";
import { LocalTime } from "@/components/LocalTime";
import { IconAlertTriangle, IconSparkles, IconTrash } from "@/components/icons";

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
  seq: number;
  baseVersionName: string | null;
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
  const plan = estimatePlan({ originals: questionCount, similarCount, maxRuns, contentCount, contentKind, stats });
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
        <p>
          每輪問 {questionCount} 題 ×（1 ＋ {similarCount} 個相似題）＝ <span className="font-semibold">{plan.questionsPerRun}</span> 題
        </p>
        <p>
          時間：一輪約 {formatMinutes(plan.runMinutes)}（刪除舊版＋上傳學習約 {plan.uploadMinutes} 分、問機器人約 {formatMinutes(plan.testMinutes)}、AI 修改約{" "}
          {plan.reviseMinutes} 分）。時間幾乎都花在等機器人回答。
        </p>
        <p>
          Claude 費用：AI 比對每題約 {formatTwd(plan.judgeUnitUsd)}（每輪 {formatTwd(plan.judgeRunUsd)}）、AI 修改 md 每次約 {formatTwd(plan.reviseUsd)}
          {similarCount > 0 && `、產生相似題（只做一次）約 ${formatTwd(plan.similarUsd)}`}
          {plan.measured.judge || plan.measured.revise ? "（依這間公司最近的實際用量）" : "（預估）"}
        </p>
        <p className="mt-1 font-semibold text-slate-700">
          跑滿 {maxRuns} 輪最多約 {formatMinutes(plan.maxMinutes)}、Claude 費用約 {formatTwd(plan.maxUsd)}；達到目標或沒進步會提早停，實際通常更少。
        </p>
        <p className="mt-1 text-slate-500">每一輪上傳前會先刪除 AIBPO 上一次上傳到後台的知識（只刪 AIBPO 記下的那批，後台原有的知識不會動）。</p>
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
            <h3 className="text-sm font-semibold text-slate-900">
              <span className="mr-1.5 text-slate-400">#{job.seq}</span>
              {job.label}
            </h3>
            {job.baseVersionName && <span className="text-[11px] text-slate-500">從 {job.baseVersionName} 繼續</span>}
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
      {modal?.kind === "results" && (
        <ResultsModal versionId={modal.run.versionId} title={`${modal.run.name} 逐題結果`} onClose={() => setModal(null)} />
      )}
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
  versions: OptVersionView[];
  deployedVersion: { id: string; name: string } | null;
};

function Workspace({
  targetReady,
  sources,
  testCaseCount,
  jobs,
  versions,
  deployedVersion,
}: WorkspaceProps) {
  const router = useRouter();
  const hasActive = jobs.some((j) => j.status === "RUNNING" || j.status === "PAUSED_TOKEN");
  const hasRunning = jobs.some((j) => j.status === "RUNNING");
  const [showForm, setShowForm] = useState(!hasActive && jobs.length === 0);
  const [clearing, setClearing] = useState(false);
  const [tab, setTab] = useState<"jobs" | "versions">("jobs");

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
        {tab === "jobs" && !showForm && (
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

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            { id: "jobs", label: "任務", count: jobs.length },
            { id: "versions", label: "版本", count: versions.length },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.id ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-slate-400">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "versions" && <VersionsTab versions={versions} hasActive={hasActive} />}

      {tab === "jobs" && showForm && (
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

      {tab !== "jobs" ? null : jobs.length === 0 ? (
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
