"use client";

import { useEffect, useState, useTransition } from "react";
import { getJobTodoAction, makeKeyPointOptionalAction, type OptimizeActionResult } from "./actions";
import { Modal } from "./optimizeShared";
import type { JobTodo, TodoQuestion, TodoStrictPoint } from "@/lib/optimizationTodo";

// 待處理清單：AI 改 md 解決不了、需要人處理的題目（原文沒有、機器人問題、關鍵答案可能太嚴、還在處理）

function TodoSection({ title, tone, count, hint, children }: { title: string; tone: string; count: number; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(count > 0 && count <= 15);
  return (
    <div className="rounded-xl border border-slate-200">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left" aria-expanded={open}>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{count}</span>
        <span className="font-semibold text-slate-800">{title}</span>
        {count > 0 && <span className="ml-auto text-[11px] text-slate-400">{open ? "收合" : "展開"}</span>}
      </button>
      <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] leading-relaxed text-slate-500">{hint}</p>
      {open && count > 0 && <div className="divide-y divide-slate-100 border-t border-slate-100">{children}</div>}
    </div>
  );
}

function TodoQuestionRow({ q }: { q: TodoQuestion }) {
  const [more, setMore] = useState(false);
  return (
    <div className="px-3 py-2.5">
      <p className="font-medium text-slate-800">{q.question}</p>
      {q.note && (
        <p className="mt-0.5 text-slate-600">
          <span className="text-slate-400">AI：</span>
          {q.note}
          {q.diagnosedIn && <span className="ml-1 text-slate-400">（{q.diagnosedIn}）</span>}
        </p>
      )}
      <button type="button" onClick={() => setMore((v) => !v)} className="mt-1 text-[11px] text-teal-700 hover:underline">
        {more ? "收起答案" : "看標準答案與機器人回答"}
      </button>
      {more && (
        <div className="mt-1.5 grid gap-2 md:grid-cols-2">
          <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-600">
            <span className="block text-[11px] font-semibold text-slate-400">標準答案</span>
            {q.expectedAnswer}
          </p>
          <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-600">
            <span className="block text-[11px] font-semibold text-slate-400">機器人回答</span>
            {q.botAnswer ?? "（沒有回答）"}
          </p>
        </div>
      )}
    </div>
  );
}

export function TodoModal({ jobId, title, onClose }: { jobId: string; title: string; onClose: () => void }) {
  const [todo, setTodo] = useState<JobTodo | null | undefined>(undefined);
  const [done, setDone] = useState<Record<string, OptimizeActionResult>>({});
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    getJobTodoAction(jobId).then(setTodo);
  }, [jobId]);

  function makeOptional(p: TodoStrictPoint) {
    const key = `${p.expectedAnswer}::${p.point}`;
    startTransition(async () => {
      const r = await makeKeyPointOptionalAction(p.expectedAnswer, p.point);
      setDone((cur) => ({ ...cur, [key]: r }));
    });
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      {todo === undefined ? (
        <p className="text-xs text-slate-500">整理中…</p>
      ) : !todo ? (
        <p className="text-xs text-slate-500">這個任務還沒有測過的版本。</p>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
            <span>
              以最佳版本 <b className="text-slate-800">{todo.bestVersionName}</b>（{todo.bestScore}%）為準，只看原題；那一版已經一致的不列。
            </span>
            <a href={`/api/optimize/jobs/${jobId}/todo`} className="ml-auto rounded-lg px-2.5 py-1 font-medium text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-50">
              下載 Excel
            </a>
          </div>

          <TodoSection
            title="原文就沒有"
            tone="bg-slate-100 text-slate-700"
            count={todo.notInSource.length}
            hint="來源檔案裡沒有寫，AI 不能編，之後也不再處理。請把內容補進來源檔案，到來源頁「重新上傳檔案」，再從最佳版本繼續優化。"
          >
            {todo.notInSource.map((q) => (
              <TodoQuestionRow key={q.question} q={q} />
            ))}
          </TodoSection>

          <TodoSection
            title="機器人本身的問題"
            tone="bg-rose-50 text-rose-700"
            count={todo.retrieval.length}
            hint="md 寫得清楚也好找，機器人還是答錯，改 md 幫助有限。可以請後台檢查機器人的檢索或設定。"
          >
            {todo.retrieval.map((q) => (
              <TodoQuestionRow key={q.question} q={q} />
            ))}
          </TodoSection>

          <TodoSection
            title="關鍵答案可能太嚴"
            tone="bg-amber-50 text-amber-700"
            count={todo.strictKeyPoints.length}
            hint="這些題目其他重點都有講到、也沒講錯，但好幾個版本都漏掉同一個必要點，多半是那一點不一定要講。覺得合理就按「改成次要」，再對最佳版本「重新比對」看新分數。"
          >
            {todo.strictKeyPoints.map((p) => {
              const r = done[`${p.expectedAnswer}::${p.point}`];
              return (
                <div key={`${p.question}::${p.point}`} className="flex flex-wrap items-start gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800">{p.question}</p>
                    <p className="mt-0.5 text-slate-600">
                      一直漏掉：<span className="rounded bg-amber-50 px-1 text-amber-800">{p.point}</span>
                      <span className="ml-1 text-slate-400">
                        （{p.missedIn}／{p.testedVersions} 個版本）
                      </span>
                    </p>
                    {r && <p className={`mt-0.5 ${r.error ? "text-rose-600" : "text-emerald-600"}`}>{r.error ?? r.success}</p>}
                  </div>
                  {!r?.success && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => makeOptional(p)}
                      className="shrink-0 rounded-lg px-2.5 py-1 font-medium text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-50 disabled:opacity-50"
                    >
                      改成次要
                    </button>
                  )}
                </div>
              );
            })}
          </TodoSection>

          <TodoSection
            title="還在處理"
            tone="bg-sky-50 text-sky-700"
            count={todo.stillWorking.length}
            hint="其他還沒答對的題目，AI 之後幾輪會繼續修改。如果你知道問題在哪，可以到逐題結果寫備註給 AI。"
          >
            {todo.stillWorking.map((q) => (
              <TodoQuestionRow key={q.question} q={q} />
            ))}
          </TodoSection>
        </div>
      )}
    </Modal>
  );
}
