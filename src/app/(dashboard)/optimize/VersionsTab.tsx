"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  compareVersionsAction,
  continueOptimizationAction,
  deployVersionAction,
  type CompareSide,
  type OptimizeActionResult,
} from "./actions";
import { Choice, Feedback, Modal, NumberField, ResultsModal, ScoreBar, TokenActionModal, TokenField, useTokenUsable } from "./optimizeShared";
import { collapseUnchanged, diffLines, diffStats } from "@/lib/lineDiff";
import { LocalTime } from "@/components/LocalTime";
import { IconSparkles } from "@/components/icons";

export type OptVersionView = {
  id: string;
  name: string;
  jobSeq: number;
  runIndex: number;
  contentKind: string;
  targetScore: number;
  scoreAll: number | null;
  scoreOriginal: number | null;
  scoreSimilar: number | null;
  inBackend: boolean;
  tested: boolean;
  createdAt: string;
};

function pctText(v: number | null) {
  return v === null ? "—" : `${v}%`;
}

function Delta({ a, b }: { a: number | null; b: number | null }) {
  if (a === null || b === null) return <span className="text-slate-300">—</span>;
  const d = b - a;
  return <span className={d > 0 ? "text-emerald-600" : d < 0 ? "text-rose-600" : "text-slate-400"}>{d > 0 ? `+${d}` : d}</span>;
}

function ContinueModal({ base, onClose }: { base: OptVersionView; onClose: () => void }) {
  const router = useRouter();
  const [maxRuns, setMaxRuns] = useState(3);
  const [targetScore, setTargetScore] = useState(base.targetScore);
  const [stallRuns, setStallRuns] = useState(2);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const usable = useTokenUsable(token);

  return (
    <Modal title={`從 ${base.name} 繼續優化`} onClose={onClose}>
      <p className="mb-4 text-xs leading-relaxed text-slate-600">
        以這一版的 md 當起點，題目（含相似題）沿用原本那一套，分數可以直接跟之前的版本比較。
        {base.tested ? `這一版已經測過（${pctText(base.scoreAll)}），會直接從它答錯的題目開始修改。` : "這一版還沒測過，會先把它上傳測試一次。"}
      </p>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <NumberField label="最多跑幾輪" hint="1–10" value={maxRuns} onChange={setMaxRuns} min={1} max={10} suffix="輪" />
        <NumberField label="目標正確率" hint="達到就停" value={targetScore} onChange={setTargetScore} min={1} max={100} suffix="%" />
        <NumberField label="沒進步就停" hint="連續幾輪" value={stallRuns} onChange={setStallRuns} min={1} max={10} suffix="輪" />
      </div>
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
                const r = await continueOptimizationAction({ baseVersionId: base.id, maxRuns, targetScore, stallRuns, token });
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

function CompareModal({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
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

export function VersionsTab({ versions, hasActive }: { versions: OptVersionView[]; hasActive: boolean }) {
  const router = useRouter();
  const [sort, setSort] = useState<"time" | "score">("time");
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<
    | null
    | { kind: "compare"; ids: [string, string] }
    | { kind: "continue"; version: OptVersionView }
    | { kind: "deploy"; version: OptVersionView }
    | { kind: "results"; version: OptVersionView }
  >(null);

  const sorted = useMemo(
    () =>
      [...versions].sort((a, b) =>
        sort === "score" ? (b.scoreAll ?? -1) - (a.scoreAll ?? -1) || b.createdAt.localeCompare(a.createdAt) : b.createdAt.localeCompare(a.createdAt),
      ),
    [versions, sort],
  );
  const bestId = useMemo(
    () => versions.reduce<OptVersionView | null>((best, v) => (v.scoreAll !== null && (!best || v.scoreAll > (best.scoreAll ?? -1)) ? v : best), null)?.id,
    [versions],
  );

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id]));
  }

  function openCompare() {
    // 舊版在前、新版在後
    const pair = versions.filter((v) => selected.includes(v.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (pair.length === 2) setModal({ kind: "compare", ids: [pair[0].id, pair[1].id] });
  }

  if (versions.length === 0) return <p className="text-sm text-slate-500">還沒有自動優化產生的版本。</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Choice
          value={sort}
          onChange={setSort}
          options={[
            { value: "time", label: "依時間" },
            { value: "score", label: "依正確率" },
          ]}
        />
        <button
          type="button"
          disabled={selected.length !== 2}
          onClick={openCompare}
          className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
        >
          比較所選版本（{selected.length}/2）
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] text-slate-400">
              <th className="w-8 px-3 py-2" />
              <th className="py-2 font-medium">版本</th>
              <th className="w-56 py-2 font-medium">正確率（全部）</th>
              <th className="w-16 py-2 text-right font-medium">原題</th>
              <th className="w-16 py-2 text-right font-medium">相似題</th>
              <th className="w-36 py-2 pl-4 font-medium">建立時間</th>
              <th className="w-72 px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((v) => (
              <tr key={v.id} className={selected.includes(v.id) ? "bg-teal-50/40" : undefined}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.includes(v.id)} onChange={() => toggle(v.id)} aria-label={`選擇 ${v.name}`} />
                </td>
                <td className="py-2 font-medium text-slate-800">
                  {v.name}
                  {bestId === v.id && <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] text-amber-700">最佳</span>}
                  {v.inBackend && <span className="ml-1.5 rounded bg-teal-50 px-1.5 text-[10px] font-semibold text-teal-700">在後台</span>}
                  <span className="ml-1.5 text-[10px] text-slate-400">{v.contentKind === "DOC" ? "結構化文件" : "FAQ"}</span>
                </td>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-2">
                    <ScoreBar value={v.scoreAll} target={v.targetScore} />
                    <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-slate-800">{pctText(v.scoreAll)}</span>
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums text-slate-600">{pctText(v.scoreOriginal)}</td>
                <td className="py-2 text-right tabular-nums text-slate-600">{pctText(v.scoreSimilar)}</td>
                <td className="py-2 pl-4 text-slate-500">
                  <LocalTime iso={v.createdAt} />
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {v.tested && (
                      <button type="button" onClick={() => setModal({ kind: "results", version: v })} className="text-teal-700 hover:underline">
                        逐題結果
                      </button>
                    )}
                    <a href={`/api/km/versions/${v.id}/download`} className="text-teal-700 hover:underline">
                      下載 md
                    </a>
                    {!hasActive && (
                      <button type="button" onClick={() => setModal({ kind: "continue", version: v })} className="text-teal-700 hover:underline">
                        從這版繼續
                      </button>
                    )}
                    {!hasActive && !v.inBackend && (
                      <button type="button" onClick={() => setModal({ kind: "deploy", version: v })} className="font-semibold text-teal-700 hover:underline">
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
      {hasActive && <p className="text-xs text-slate-400">有進行中（或暫停中）的自動優化時，不能繼續優化或部署其他版本。</p>}

      {modal?.kind === "compare" && <CompareModal ids={modal.ids} onClose={() => setModal(null)} />}
      {modal?.kind === "continue" && <ContinueModal base={modal.version} onClose={() => setModal(null)} />}
      {modal?.kind === "results" && (
        <ResultsModal versionId={modal.version.id} title={`${modal.version.name} 逐題結果`} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "deploy" && (
        <TokenActionModal
          title={`部署 ${modal.version.name} 到後台`}
          description={<>會先刪除 AIBPO 先前上傳到後台的知識（只刪 AIBPO 記下的那批），再上傳「{modal.version.name}」並送出學習。</>}
          confirmLabel="部署"
          onSubmit={async (token) => {
            const r = await deployVersionAction(modal.version.id, token);
            router.refresh();
            return r;
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
