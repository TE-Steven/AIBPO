"use client";

import { useState, useTransition } from "react";
import { createTestCaseAction, updateTestCaseAction, setTestCaseArchivedAction } from "./actions";
import type { TestCaseView, VersionView } from "./knowledgeTypes";
import { IconAlertTriangle, IconCheckCircle, IconPencil, IconPlus } from "@/components/icons";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

// 每一題在各版本（有測過的，舊到新）的結果小圖示：綠＝一致、紅＝不一致、灰＝沒回答或沒測到
function HistoryDots({ testCaseId, versions }: { testCaseId: string; versions: VersionView[] }) {
  const tested = versions.filter((v) => v.latestRun).slice().reverse();
  if (tested.length === 0) return null;
  return (
    <div className="flex items-center gap-1" aria-label="各版本結果">
      {tested.map((v) => {
        const r = v.latestRun!.results.find((x) => x.testCaseId === testCaseId);
        const color = !r
          ? "bg-slate-200"
          : r.judgeVerdict === "MATCH"
            ? "bg-emerald-500"
            : r.judgeVerdict === "PARTIAL"
              ? "bg-amber-400"
              : r.judgeVerdict === "MISMATCH"
                ? "bg-rose-500"
                : "bg-slate-300";
        const label = !r
          ? "沒測到"
          : r.judgeVerdict === "MATCH"
            ? "一致"
            : r.judgeVerdict === "PARTIAL"
              ? "部分一致"
              : r.judgeVerdict === "MISMATCH"
                ? "不一致"
                : r.status === "TIMEOUT"
                  ? "逾時"
                  : "沒有結果";
        return <span key={v.id} title={`${v.name}：${label}`} className={`h-2.5 w-2.5 rounded-full ${color}`} />;
      })}
    </div>
  );
}

function TestCaseRow({ testCase, index, versions }: { testCase: TestCaseView; index: number; versions: VersionView[] }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(testCase.question);
  const [answer, setAnswer] = useState(testCase.expectedAnswer);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateTestCaseAction(testCase.id, { question, expectedAnswer: answer });
      if (result.error) setError(result.error);
      else setEditing(false);
    });
  }

  function toggleArchived() {
    startTransition(async () => {
      await setTestCaseArchivedAction(testCase.id, !testCase.archived);
    });
  }

  return (
    <div className={`rounded-lg border p-4 ${testCase.archived ? "border-dashed border-slate-300 bg-slate-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start gap-3">
        <span className="pt-0.5 text-xs tabular-nums text-slate-400">{index}</span>
        <div className="min-w-0 flex-1 space-y-2">
          {editing ? (
            <>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="題目" className={inputClass} />
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} aria-label="標準答案" className={inputClass} />
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <div className="flex items-center gap-3 text-xs">
                <button type="button" onClick={save} disabled={pending} className="rounded-md bg-teal-600 px-3 py-1.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
                  儲存
                </button>
                <button type="button" onClick={() => setEditing(false)} className="font-medium text-slate-500 hover:text-slate-700">
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={`text-sm font-medium ${testCase.archived ? "text-slate-400 line-through" : "text-slate-800"}`}>{testCase.question}</p>
              <p className="whitespace-pre-wrap text-xs text-slate-500">{testCase.expectedAnswer}</p>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 flex-col items-end gap-2">
            <HistoryDots testCaseId={testCase.id} versions={versions} />
            <div className="flex items-center gap-3 text-xs">
              <button type="button" onClick={() => setEditing(true)} aria-label="編輯測試題" className="text-slate-400 hover:text-teal-600">
                <IconPencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={toggleArchived} disabled={pending} className="font-medium text-slate-500 hover:text-teal-700">
                {testCase.archived ? "重新啟用" : "停用"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TestBankPanel({ testCases, versions }: { testCases: TestCaseView[]; versions: VersionView[] }) {
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState<{ success?: string; error?: string }>({});
  const [showArchived, setShowArchived] = useState(false);
  const [pending, startTransition] = useTransition();

  const active = testCases.filter((t) => !t.archived);
  const archived = testCases.filter((t) => t.archived);

  function add() {
    startTransition(async () => {
      const result = await createTestCaseAction({ question, expectedAnswer: answer });
      setMessage(result);
      if (result.success) {
        setQuestion("");
        setAnswer("");
        setAdding(false);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <span>
          每個版本都用這套題目測試，正確率才能公平比較。目前啟用 <b>{active.length}</b> 題
          {archived.length > 0 && `、停用 ${archived.length} 題`}。可以在「題目」分頁勾選 FAQ 一鍵加入，也可以手動新增（例如客人實際問過的問題）。
        </span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3 py-1.5 font-semibold text-white shadow-sm"
        >
          <IconPlus className="h-3.5 w-3.5" />
          新增測試題
        </button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-xl border border-teal-200 bg-white p-4 shadow-sm">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="題目（客人會怎麼問）" aria-label="新測試題題目" className={inputClass} />
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder="標準答案" aria-label="新測試題標準答案" className={inputClass} />
          <div className="flex items-center gap-3 text-xs">
            <button type="button" onClick={add} disabled={pending} className="rounded-md bg-teal-600 px-3 py-1.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              加入題庫
            </button>
            <button type="button" onClick={() => setAdding(false)} className="font-medium text-slate-500 hover:text-slate-700">
              取消
            </button>
          </div>
        </div>
      )}
      {(message.success || message.error) && (
        <p
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${
            message.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
          }`}
        >
          {message.error ? <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <IconCheckCircle className="h-3.5 w-3.5 shrink-0" />}
          {message.error ?? message.success}
        </p>
      )}

      {active.map((t, i) => (
        <TestCaseRow key={t.id} testCase={t} index={i + 1} versions={versions} />
      ))}
      {active.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
          測試題庫是空的：到「題目」分頁勾選 FAQ 後按「加入測試題庫」。
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
            {showArchived ? "隱藏" : "顯示"}已停用的 {archived.length} 題
          </button>
          {showArchived && (
            <div className="mt-2 space-y-2">
              {archived.map((t, i) => (
                <TestCaseRow key={t.id} testCase={t} index={i + 1} versions={versions} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
