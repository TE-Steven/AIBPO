"use client";

import { useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  compareVersionsAction,
  getRevisionLogAction,
  continueOptimizationAction,
  rejudgeVersionAction,
  type CompareSide,
  type OptimizeActionResult,
} from "./actions";
import {
  Choice,
  OptionCards,
  estimatePlan,
  InfoTip,
  TIPS,
  Feedback,
  formatMinutes,
  formatTwd,
  Modal,
  ModelRow,
  StepperField,
  TokenField,
  UsageStatsContext,
  useTokenUsable,
  BotsContext,
  BotSelect,
} from "./optimizeShared";
import { collapseUnchanged, diffLines, diffStats } from "@/lib/lineDiff";
import { EDIT_CAUSE_LABELS, type EditCause, type RevisionLog } from "@/lib/optimizationPrompts";
import { IconSparkles } from "@/components/icons";
import { isPassVerdict } from "@/lib/keyPoints";
import { modelCostUsd } from "@/lib/aiModels";

// 「從這版繼續」需要的起點版本資訊
export type ContinueBase = {
  id: string;
  name: string;
  targetScore: number;
  tested: boolean;
  scoreAll: number | null;
  questionsPerRun: number;
  // 換題目時可選的題目數：範圍內目前的 FAQ、測試題庫
  currentFaqCount: number;
  testCaseCount: number;
  similarModel: string;
  entryCount: number;
  contentKind: string;
  judgeModel: string;
  reviseModel: string;
  learnWaitMinutes: number;
  botId: string | null;
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
  const bots = useContext(BotsContext);
  const [botId, setBotId] = useState(base.botId && bots.some((b) => b.id === base.botId) ? base.botId : (bots[0]?.id ?? ""));
  const [judgeModel, setJudgeModel] = useState(base.judgeModel);
  const [reviseModel, setReviseModel] = useState(base.reviseModel);
  const [questionMode, setQuestionMode] = useState<"REUSE" | "ENTRIES" | "TEST_BANK">("REUSE");
  const [similarCount, setSimilarCount] = useState(1);
  const [similarModel, setSimilarModel] = useState(base.similarModel);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const usable = useTokenUsable(token);
  const stats = useContext(UsageStatsContext);
  // 沿用題目：相似題已包含在題數裡、起點測過就從修改開始；換題目：起點版本一律先用新題目測一輪
  const reuse = questionMode === "REUSE";
  const newCount = questionMode === "TEST_BANK" ? base.testCaseCount : base.currentFaqCount;
  const startsTested = reuse && base.tested;
  const plan = estimatePlan({
    originals: reuse ? base.questionsPerRun : newCount,
    similarCount: reuse ? 0 : similarCount,
    maxRuns,
    contentCount: base.entryCount,
    contentKind: base.contentKind === "DOC" ? "DOC" : "FAQ",
    stats,
    judgeModel,
    reviseModel,
    similarModel,
    skipSimilar: reuse,
    learnWaitMinutes,
  });
  const maxUsd = startsTested ? plan.judgeRunUsd * maxRuns + plan.reviseUsd * maxRuns : plan.maxUsd;
  // 起點測過：每輪都是「修改→上傳→測試」，共修改 maxRuns 次
  const maxMinutes = startsTested ? plan.runMinutes * maxRuns : plan.maxMinutes;

  return (
    <Modal title={`從 ${base.name} 繼續優化`} onClose={onClose} wide>
      <div className="mb-4">
        <p className="mb-1.5 flex items-center text-xs font-semibold text-slate-700">
          題目來源
          <InfoTip>
            沿用原本的題目，分數可以直接跟之前的版本比較。換成其他題目時，起點版本的舊分數是別套題目測的，所以會先用新題目把這份 md 測一輪，新任務的分數只在新任務裡互相比較。最多跑 1 輪＝只用新題目測一次、不修改。
          </InfoTip>
        </p>
        <OptionCards
          value={questionMode}
          onChange={setQuestionMode}
          options={[
            { value: "REUSE", label: "沿用原本的題目", desc: "含相似題與備註，分數能跟之前的版本比", badge: `${base.questionsPerRun} 題` },
            { value: "TEST_BANK", label: "測試題庫", desc: "知識列表的固定測試題庫", badge: `${base.testCaseCount} 題`, disabled: base.testCaseCount === 0 },
            {
              value: "ENTRIES",
              label: "範圍內目前的 FAQ",
              desc: "照知識列表／來源目前的內容重新取題（含新增、修改過的）",
              badge: `${base.currentFaqCount} 題`,
              disabled: base.currentFaqCount === 0,
            },
          ]}
        />
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-600">
        以這一版的 md 當起點。
        {reuse
          ? base.tested
            ? `題目沿用原本那一套；這一版已經測過（${pctText(base.scoreAll)}），會直接從它答錯的題目開始修改。`
            : "題目沿用原本那一套；這一版還沒測過，會先把它上傳測試一次。"
          : `會先用${questionMode === "TEST_BANK" ? "測試題庫" : "範圍內目前的 FAQ"}（${newCount} 題${similarCount > 0 ? `＋每題 ${similarCount} 個相似題` : ""}）把這份 md 測一輪，再依答錯的題目繼續修改。${maxRuns === 1 ? "最多 1 輪：只測不改。" : ""}`}
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <StepperField label="最多跑幾輪" hint={reuse ? "1–10 輪" : "1 輪＝只用新題目測一次、不修改"} value={maxRuns} onChange={setMaxRuns} min={1} max={10} suffix="輪" />
        {!reuse && (
          <StepperField label="每題相似問法" hint="0–5 個，只用來驗收、不給 AI 修改時看" value={similarCount} onChange={setSimilarCount} min={0} max={5} suffix="個" />
        )}
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
      <div className="mb-4">
        <p className="mb-1.5 text-xs font-semibold text-slate-700">要問哪一隻機器人</p>
        <BotSelect value={botId} onChange={setBotId} />
      </div>
      <div className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
        <ModelRow
          title="比對答案"
          desc={`每輪約 ${plan.askedPerRun} 次，含沒答對再問一次（每題約 ${formatTwd(plan.judgeUnitUsd)}）`}
          value={judgeModel}
          onChange={setJudgeModel}
          cost={`${formatTwd(plan.judgeRunUsd)}／輪`}
        />
        <ModelRow title="修改 md" desc="每輪兩批，各 10 題" value={reviseModel} onChange={setReviseModel} cost={`${formatTwd(plan.reviseUsd)}／次`} />
        {!reuse && similarCount > 0 && (
          <ModelRow
            title="產生相似題"
            desc={`開始時產生一次，共 ${newCount * similarCount} 題`}
            value={similarModel}
            onChange={setSimilarModel}
            cost={formatTwd(plan.similarUsd)}
          />
        )}
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
                  botId,
                  token,
                  questionMode,
                  similarCount,
                  similarModel,
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
      // 答對：一致或部分一致
      const okA = isPassVerdict(ra?.verdict);
      const okB = isPassVerdict(rb.verdict);
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
                <th className="w-24 py-1 text-right font-medium">
                  <span className="inline-flex items-center">全部<InfoTip>{TIPS.scoreAll}</InfoTip></span>
                </th>
                <th className="w-24 py-1 text-right font-medium">
                  <span className="inline-flex items-center">原題<InfoTip>{TIPS.scoreOriginal}</InfoTip></span>
                </th>
                <th className="w-24 py-1 text-right font-medium">
                  <span className="inline-flex items-center">相似題<InfoTip>{TIPS.scoreSimilar}</InfoTip></span>
                </th>
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

          <div className="flex items-center gap-1">
            <Choice
              value={tab}
              onChange={setTab}
              options={[
                { value: "questions", label: "題目變化", hint: `變對 ${improved.length}・變錯 ${regressed.length}` },
                { value: "markdown", label: "md 差異", hint: diff ? `+${diffStats(diff).added} −${diffStats(diff).removed} 行` : "" },
              ]}
            />
            <InfoTip>{TIPS.compareChange}</InfoTip>
          </div>

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

// 修改說明最上方的閱讀指南（可以收合，記住使用者的選擇）
function RevisionGuide() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("aibpo.revisionGuide") !== "closed";
    } catch {
      return true;
    }
  });
  function toggle() {
    setOpen((v) => {
      try {
        localStorage.setItem("aibpo.revisionGuide", v ? "closed" : "open");
      } catch {
        // 無痕模式等存不了就算了
      }
      return !v;
    });
  }
  const causes: [EditCause, string, string][] = [
    ["MISSING_INFO", "原始檔案有，但 md 漏掉了 → 把內容補進對的段落", "不用處理"],
    ["HARD_TO_FIND", "md 有寫，但機器人找不到 → 補上同義詞、客戶問法", "不用處理"],
    ["AMBIGUOUS", "md 前後說法不一致或容易誤解 → 改寫成清楚一致的說法", "不用處理"],
    ["NOT_IN_SOURCE", "原始檔案根本沒寫，AI 不能編 → 之後不再處理這題", "把內容補進來源檔案，再到來源頁「重新上傳檔案」"],
    ["RETRIEVAL", "md 寫得清楚也好找，機器人還是答錯 → 不改 md", "屬於後台機器人的檢索或設定問題"],
  ];
  return (
    <div className="rounded-xl border border-teal-100 bg-teal-50/40">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between px-3 py-2 text-left font-semibold text-teal-800" aria-expanded={open}>
        怎麼看這份修改說明
        <span className="text-[11px] font-normal text-teal-700">{open ? "收合" : "展開"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-teal-100 px-3 py-3 leading-relaxed text-slate-600">
          <div>
            <p className="font-semibold text-slate-700">1. 這一版的來歷</p>
            <p>
              起點是當時這個任務<b>分數最高的版本</b>（不一定是上一輪；上一輪退步就會跳回更早的高分版本）。正常是「局部修改」，只改跟答錯題目有關的段落；AI 提的修改全都對不上 md 時才會「整份重寫」。md 長度一輪通常是個位數百分比。
            </p>
          </div>
          <div>
            <p className="mb-1 font-semibold text-slate-700">2. 答錯原因（每題一個標籤）</p>
            <div className="space-y-1">
              {causes.map(([cause, desc, todo]) => (
                <div key={cause} className="flex flex-wrap items-start gap-x-2 gap-y-0.5">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${CAUSE_STYLE[cause]}`}>{EDIT_CAUSE_LABELS[cause]}</span>
                  <span className="min-w-0 flex-1">
                    {desc}
                    <span className="ml-1 text-slate-400">｜你可以：{todo}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-slate-500">標籤大多是前三種，代表還有東西可以修；「原文就沒有」「機器人本身的問題」越來越多，代表快碰到天花板，需要你介入。</p>
          </div>
          <div>
            <p className="font-semibold text-slate-700">3. 修改清單</p>
            <p>
              每一項有動作（改寫／插入／刪除）、理由、對應題目和前後對照：<span className="rounded bg-rose-50 px-1 text-rose-800 line-through">紅底刪除線</span>是被改掉的原文，
              <span className="rounded bg-slate-100 px-1 text-slate-500">灰底「接在：」</span>是插入的位置，<span className="rounded bg-emerald-50 px-1 text-emerald-800">綠底</span>是新寫的內容。虛線框的項目沒有套用，旁邊會寫原因：定位不到（AI 引用的原文找不到），或違反分類結構（想新增、改名或刪除分類層級的標題）。
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-700">4. 改得好不好，要看下一版的測試</p>
            <p>
              勾選起點版本和這一版按「比較」，看這裡列出的題目有沒有變對、別的題目有沒有被改壞；還答錯的題目可以打開「逐題結果」看機器人怎麼回答，寫備註告訴 AI 問題在哪。連續好幾輪都沒改好的題目，系統會把之前的改法附給 AI，要它換一種做法。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

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
          <RevisionGuide />
          <p className="flex flex-wrap items-center rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
            從 <span className="mx-1 font-semibold text-slate-800">{log.baseVersionName}</span>
            {log.mode === "edits" ? "局部修改" : "整份重寫（局部修改都定位不到）"}，md 長度 {log.growthPct >= 0 ? "+" : ""}
            {log.growthPct}%<InfoTip>{TIPS.mdGrowth}</InfoTip>。只看原題的錯誤，相似題只當驗收。
          </p>

          <div>
            <p className="mb-2 flex items-center font-semibold text-slate-700">
              答錯原因（{log.diagnoses.length} 題）<InfoTip>{TIPS.diagnoses}</InfoTip>
            </p>
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
              <p className="mb-2 flex items-center font-semibold text-slate-700">
                修改清單（套用 {log.edits.filter((e) => e.applied).length}／{log.edits.length} 項）<InfoTip>{TIPS.editsApplied}</InfoTip>
              </p>
              <div className="space-y-2">
                {log.edits.map((e, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${e.applied ? "border-slate-200" : "border-dashed border-slate-300 opacity-60"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-700">{ACTION_LABEL[e.action] ?? e.action}</span>
                      {!e.applied && (
                        <span className={`rounded px-1.5 py-0.5 ${e.rejected ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                          {e.rejected ? `違反分類結構，沒有套用：${e.rejected}` : "定位不到，沒有套用"}
                        </span>
                      )}
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

// 重新比對某一版：用存好的機器人回答依目前的比對規則重判（不重問機器人、不需要 token）
export function RejudgeModal({
  versionId,
  name,
  answered,
  defaultModel,
  onClose,
}: {
  versionId: string;
  name: string;
  // 有機器人回答、會重新比對的題數
  answered: number;
  defaultModel: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const stats = useContext(UsageStatsContext);
  const [model, setModel] = useState(defaultModel);
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  // 新的比對會多附完整標準答案，輸入量比過去的平均多一些
  const unit = stats.judge ?? { input: 900, output: 80 };
  const cost = answered * modelCostUsd(model, unit.input + 400, unit.output + 60);
  return (
    <Modal title={`重新比對 ${name}`} onClose={onClose}>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        用這一版測試時存下來的機器人回答，依目前的比對規則再判一次，重算正確率。不會重新問機器人，也不需要 token；約需 1～5 分鐘，完成後分數自動更新。
      </p>
      <div className="mb-4 overflow-hidden rounded-xl ring-1 ring-inset ring-slate-200">
        <ModelRow title="AI 比對" desc={`約 ${answered} 題`} value={model} onChange={setModel} cost={formatTwd(cost)} />
      </div>
      <Feedback result={result} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          {result?.success ? "關閉" : "取消"}
        </button>
        {!result?.success && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await rejudgeVersionAction(versionId, model);
                setResult(r);
                router.refresh();
              })
            }
            className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            開始重新比對
          </button>
        )}
      </div>
    </Modal>
  );
}
