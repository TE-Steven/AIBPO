"use client";

import { useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  compareVersionsAction,
  getRevisionLogAction,
  continueOptimizationAction,
  type CompareSide,
  type OptimizeActionResult,
} from "./actions";
import {
  Choice,
  estimatePlan,
  Feedback,
  formatMinutes,
  formatTwd,
  Modal,
  ModelRow,
  StepperField,
  TokenField,
  UsageStatsContext,
  useTokenUsable,
} from "./optimizeShared";
import { collapseUnchanged, diffLines, diffStats } from "@/lib/lineDiff";
import { EDIT_CAUSE_LABELS, type EditCause, type RevisionLog } from "@/lib/optimizationPrompts";
import { IconSparkles } from "@/components/icons";

// 「從這版繼續」需要的起點版本資訊
export type ContinueBase = {
  id: string;
  name: string;
  targetScore: number;
  tested: boolean;
  scoreAll: number | null;
  questionsPerRun: number;
  entryCount: number;
  contentKind: string;
  judgeModel: string;
  reviseModel: string;
  learnWaitMinutes: number;
};

function pctText(v: number | null) {
  return v === null ? "—" : `${v}%`;
}

function Delta({ a, b }: { a: number | null; b: number | null }) {
  if (a === null || b === null) return <span className="text-slate-300">—</span>;
  const d = b - a;
  return <span className={d > 0 ? "text-emerald-600" : d < 0 ? "text-rose-600" : "text-slate-400"}>{d > 0 ? `+${d}` : d}</span>;
}

export function ContinueModal({ base, onClose }: { base: ContinueBase; onClose: () => void }) {
  const router = useRouter();
  const [maxRuns, setMaxRuns] = useState(3);
  const [targetScore, setTargetScore] = useState(base.targetScore);
  const [stallRuns, setStallRuns] = useState(2);
  const [learnWaitMinutes, setLearnWaitMinutes] = useState(base.learnWaitMinutes);
  const [judgeModel, setJudgeModel] = useState(base.judgeModel);
  const [reviseModel, setReviseModel] = useState(base.reviseModel);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const usable = useTokenUsable(token);
  const stats = useContext(UsageStatsContext);
  // 題目沿用（相似題已包含在題數裡）；起點測過就從修改開始，所以第一輪不用先測
  const plan = estimatePlan({
    originals: base.questionsPerRun,
    similarCount: 0,
    maxRuns,
    contentCount: base.entryCount,
    contentKind: base.contentKind === "DOC" ? "DOC" : "FAQ",
    stats,
    judgeModel,
    reviseModel,
    similarModel: judgeModel,
    skipSimilar: true,
    learnWaitMinutes,
  });
  const maxUsd = base.tested ? plan.judgeRunUsd * maxRuns + plan.reviseUsd * maxRuns : plan.maxUsd;
  // 起點測過：每輪都是「修改→上傳→測試」，共修改 maxRuns 次
  const maxMinutes = base.tested ? plan.runMinutes * maxRuns : plan.maxMinutes;

  return (
    <Modal title={`從 ${base.name} 繼續優化`} onClose={onClose} wide>
      <p className="mb-4 text-xs leading-relaxed text-slate-600">
        以這一版的 md 當起點，題目（含相似題）沿用原本那一套，分數可以直接跟之前的版本比較。
        {base.tested ? `這一版已經測過（${pctText(base.scoreAll)}），會直接從它答錯的題目開始修改。` : "這一版還沒測過，會先把它上傳測試一次。"}
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <StepperField label="最多跑幾輪" hint="1–10 輪" value={maxRuns} onChange={setMaxRuns} min={1} max={10} suffix="輪" />
        <StepperField label="目標正確率" hint="任何一輪達到就停" value={targetScore} onChange={setTargetScore} min={1} max={100} suffix="%" />
        <StepperField label="連續沒進步就停" hint="含起點版本的分數" value={stallRuns} onChange={setStallRuns} min={1} max={10} suffix="輪" />
        <StepperField
          label="呼叫學習後至少等"
          hint="之後試問第一題，沒回答就再等同樣時間重試（0–30 分）"
          value={learnWaitMinutes}
          onChange={setLearnWaitMinutes}
          min={0}
          max={30}
          suffix="分鐘"
        />
      </div>
      <div className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
        <ModelRow
          title="比對答案"
          desc={`每輪 ${plan.questionsPerRun} 次（每題約 ${formatTwd(plan.judgeUnitUsd)}）`}
          value={judgeModel}
          onChange={setJudgeModel}
          cost={`${formatTwd(plan.judgeRunUsd)}／輪`}
        />
        <ModelRow title="修改 md" desc="每輪一次" value={reviseModel} onChange={setReviseModel} cost={`${formatTwd(plan.reviseUsd)}／次`} />
      </div>
      <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        每輪 {plan.questionsPerRun} 題、一輪約 {formatMinutes(plan.runMinutes)}；跑滿 {maxRuns} 輪最多約 {formatMinutes(maxMinutes)}、Claude 費用約{" "}
        <span className="font-semibold">{formatTwd(maxUsd)}</span>。
      </p>
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
                const r = await continueOptimizationAction({
                  baseVersionId: base.id,
                  maxRuns,
                  targetScore,
                  stallRuns,
                  learnWaitMinutes,
                  judgeModel,
                  reviseModel,
                  token,
                });
                setResult(r);
                if (r.success) {
                  setToken("");
                  router.refresh();
                }
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
          >
            <IconSparkles className="h-3.5 w-3.5" />
            {pending ? "啟動中…" : "開始繼續優化"}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function CompareModal({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
  const [sides, setSides] = useState<[CompareSide, CompareSide] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"questions" | "markdown">("questions");

  useEffect(() => {
    compareVersionsAction(ids).then((r) => (r.sides ? setSides(r.sides) : setError(r.error ?? "載入失敗")));
  }, [ids]);

  const questionRows = useMemo(() => {
    if (!sides) return [];
    const [a, b] = sides;
    const byQuestion = new Map(a.results.map((r) => [r.question.trim(), r]));
    return b.results.map((rb) => {
      const ra = byQuestion.get(rb.question.trim()) ?? null;
      const okA = ra?.verdict === "MATCH";
      const okB = rb.verdict === "MATCH";
      const change = !ra ? "new" : okA && !okB ? "regressed" : !okA && okB ? "improved" : okB ? "same-ok" : "same-wrong";
      return { question: rb.question, isSimilar: rb.isSimilar, a: ra, b: rb, change };
    });
  }, [sides]);

  const diff = useMemo(() => (sides ? diffLines(sides[0].markdown, sides[1].markdown) : null), [sides]);

  const improved = questionRows.filter((r) => r.change === "improved");
  const regressed = questionRows.filter((r) => r.change === "regressed");
  const stillWrong = questionRows.filter((r) => r.change === "same-wrong");

  return (
    <Modal title="版本比較" onClose={onClose} wide>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {!sides && !error && <p className="text-xs text-slate-500">載入中…</p>}
      {sides && (
        <div className="space-y-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-400">
                <th className="py-1 font-medium">版本</th>
                <th className="w-20 py-1 text-right font-medium">全部</th>
                <th className="w-20 py-1 text-right font-medium">原題</th>
                <th className="w-20 py-1 text-right font-medium">相似題</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sides.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 font-medium text-slate-700">{s.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{pctText(s.scoreAll)}</td>
                  <td className="py-1.5 text-right tabular-nums">{pctText(s.scoreOriginal)}</td>
                  <td className="py-1.5 text-right tabular-nums">{pctText(s.scoreSimilar)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 text-slate-500">差異</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  <Delta a={sides[0].scoreAll} b={sides[1].scoreAll} />
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  <Delta a={sides[0].scoreOriginal} b={sides[1].scoreOriginal} />
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  <Delta a={sides[0].scoreSimilar} b={sides[1].scoreSimilar} />
                </td>
              </tr>
            </tbody>
          </table>

          <Choice
            value={tab}
            onChange={setTab}
            options={[
              { value: "questions", label: "題目變化", hint: `變對 ${improved.length}・變錯 ${regressed.length}` },
              { value: "markdown", label: "md 差異", hint: diff ? `+${diffStats(diff).added} −${diffStats(diff).removed} 行` : "" },
            ]}
          />

          {tab === "questions" ? (
            questionRows.length === 0 ? (
              <p className="text-xs text-slate-500">新版本還沒有測試結果。</p>
            ) : (
              <div className="space-y-4">
                {[
                  { title: "變對了", rows: improved, color: "text-emerald-700" },
                  { title: "變錯了", rows: regressed, color: "text-rose-700" },
                  { title: "兩版都答錯", rows: stillWrong, color: "text-slate-600" },
                ].map((group) => (
                  <div key={group.title}>
                    <p className={`mb-1.5 text-xs font-semibold ${group.color}`}>
                      {group.title}（{group.rows.length}）
                    </p>
                    {group.rows.length === 0 ? (
                      <p className="text-xs text-slate-400">沒有</p>
                    ) : (
                      <div className="space-y-2">
                        {group.rows.map((r, i) => (
                          <div key={i} className="rounded-lg border border-slate-200 p-3 text-xs">
                            <p className="font-medium text-slate-800">
                              {r.isSimilar && <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">相似題</span>}
                              {r.question}
                            </p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <div>
                                <p className="text-[11px] font-semibold text-slate-400">{sides[0].name}</p>
                                <p className="whitespace-pre-wrap text-slate-600">{r.a?.botAnswer ?? "（沒有回答）"}</p>
                                {r.a && r.a.verdict !== "MATCH" && r.a.reason && <p className="mt-1 text-rose-600">原因：{r.a.reason}</p>}
                              </div>
                              <div>
                                <p className="text-[11px] font-semibold text-slate-400">{sides[1].name}</p>
                                <p className="whitespace-pre-wrap text-slate-600">{r.b.botAnswer ?? "（沒有回答）"}</p>
                                {r.b.verdict !== "MATCH" && r.b.reason && <p className="mt-1 text-rose-600">原因：{r.b.reason}</p>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : !diff ? (
            <p className="text-xs text-slate-500">兩份 md 太長，無法逐行比對，請下載後用其他工具比較。</p>
          ) : diffStats(diff).added + diffStats(diff).removed === 0 ? (
            <p className="text-xs text-slate-500">兩份 md 內容完全相同。</p>
          ) : (
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200 font-mono text-[11px] leading-relaxed">
              {collapseUnchanged(diff, 2).map((row, i) =>
                row.type === "skip" ? (
                  <div key={i} className="bg-slate-50 px-3 py-0.5 text-slate-400">⋯ 略過 {row.count} 行相同內容</div>
                ) : (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap px-3 ${
                      row.type === "add" ? "bg-emerald-50 text-emerald-800" : row.type === "del" ? "bg-rose-50 text-rose-800 line-through decoration-rose-300" : "text-slate-600"
                    }`}
                  >
                    {row.type === "add" ? "+ " : row.type === "del" ? "− " : "  "}
                    {row.text || " "}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const CAUSE_STYLE: Record<EditCause, string> = {
  MISSING_INFO: "bg-sky-50 text-sky-700",
  HARD_TO_FIND: "bg-violet-50 text-violet-700",
  AMBIGUOUS: "bg-amber-50 text-amber-700",
  NOT_IN_SOURCE: "bg-slate-100 text-slate-600",
  RETRIEVAL: "bg-rose-50 text-rose-700",
};

const ACTION_LABEL: Record<string, string> = { replace: "改寫", insert_after: "插入", delete: "刪除" };

// 這一版怎麼來的：從哪一版改、每題答錯的原因、套用了哪些修改
export function RevisionLogModal({ versionId, title, onClose }: { versionId: string; title: string; onClose: () => void }) {
  const [log, setLog] = useState<RevisionLog | null | undefined>(undefined);
  useEffect(() => {
    getRevisionLogAction(versionId).then(setLog);
  }, [versionId]);

  return (
    <Modal title={title} onClose={onClose} wide>
      {log === undefined ? (
        <p className="text-xs text-slate-500">載入中…</p>
      ) : !log ? (
        <p className="text-xs text-slate-500">這一版沒有修改紀錄（第一輪原始內容，或是舊版本）。</p>
      ) : (
        <div className="space-y-5 text-xs">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
            從 <span className="font-semibold text-slate-800">{log.baseVersionName}</span>{" "}
            {log.mode === "edits" ? "局部修改" : "整份重寫（局部修改都定位不到）"}，md 長度 {log.growthPct >= 0 ? "+" : ""}
            {log.growthPct}%。只看原題的錯誤，相似題只當驗收。
          </p>

          <div>
            <p className="mb-2 font-semibold text-slate-700">答錯原因（{log.diagnoses.length} 題）</p>
            <div className="space-y-1.5">
              {log.diagnoses.map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${CAUSE_STYLE[d.cause] ?? "bg-slate-100 text-slate-600"}`}>
                    {EDIT_CAUSE_LABELS[d.cause] ?? d.cause}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{d.question}</p>
                    <p className="text-slate-500">{d.note}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">「原文就沒有」的題目之後不再拿來修改；「機器人本身的問題」md 改了也沒用，可以請後台檢查。</p>
          </div>

          {log.mode === "edits" && (
            <div>
              <p className="mb-2 font-semibold text-slate-700">修改清單（套用 {log.edits.filter((e) => e.applied).length}／{log.edits.length} 項）</p>
              <div className="space-y-2">
                {log.edits.map((e, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${e.applied ? "border-slate-200" : "border-dashed border-slate-300 opacity-60"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-700">{ACTION_LABEL[e.action] ?? e.action}</span>
                      {!e.applied && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">定位不到，沒有套用</span>}
                      <span className="text-slate-600">{e.reason}</span>
                    </div>
                    {e.questions.length > 0 && <p className="mt-1 text-[11px] text-slate-400">對應題目：{e.questions.join("、")}</p>}
                    <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed">
                      {e.action !== "insert_after" && <p className="whitespace-pre-wrap rounded bg-rose-50 px-2 py-1 text-rose-800 line-through decoration-rose-300">{e.anchor}</p>}
                      {e.action === "insert_after" && <p className="whitespace-pre-wrap rounded bg-slate-50 px-2 py-1 text-slate-500">接在：{e.anchor}</p>}
                      {e.action !== "delete" && <p className="whitespace-pre-wrap rounded bg-emerald-50 px-2 py-1 text-emerald-800">{e.text}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
