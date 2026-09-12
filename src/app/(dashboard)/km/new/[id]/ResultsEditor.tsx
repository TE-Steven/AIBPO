"use client";

import { useState, useTransition } from "react";
import { updateKmEntryAction, deleteKmEntryAction } from "./actions";
import { IconTrash, IconCheckCircle } from "@/components/icons";

type Entry = {
  id: string;
  question: string;
  answer: string;
  tallyId: string | null;
};

export function ResultsEditor({
  entries,
  tallyOptions,
}: {
  entries: Entry[];
  tallyOptions: { id: string; label: string }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(entries.map((e) => e.id)));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === entries.length ? new Set() : new Set(entries.map((e) => e.id))));
  }

  const exportHref = `/api/km/export?ids=${Array.from(selected).join(",")}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={selected.size === entries.length && entries.length > 0}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-400"
          />
          全選（已選 {selected.size} / {entries.length}）
        </label>
        <a
          href={selected.size > 0 ? exportHref : undefined}
          aria-disabled={selected.size === 0}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
            selected.size > 0
              ? "bg-gradient-to-r from-violet-600 to-indigo-500 shadow-violet-500/25 hover:from-violet-700 hover:to-indigo-600"
              : "cursor-not-allowed bg-slate-300"
          }`}
        >
          匯出所選為 .md
        </a>
      </div>

      {entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          tallyOptions={tallyOptions}
          checked={selected.has(entry.id)}
          onToggle={() => toggle(entry.id)}
        />
      ))}

      {entries.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
          還沒有產出任何 KM
        </div>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  tallyOptions,
  checked,
  onToggle,
}: {
  entry: Entry;
  tallyOptions: { id: string; label: string }[];
  checked: boolean;
  onToggle: () => void;
}) {
  const [question, setQuestion] = useState(entry.question);
  const [answer, setAnswer] = useState(entry.answer);
  const [tallyId, setTallyId] = useState(entry.tallyId ?? "");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save(patch: Partial<{ question: string; answer: string; tallyId: string | null }>) {
    startTransition(async () => {
      await updateKmEntryAction(entry.id, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-400"
        />
        <div className="flex-1 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">題目</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onBlur={() => question !== entry.question && save({ question })}
              rows={1}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">答案</label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onBlur={() => answer !== entry.answer && save({ answer })}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
            />
          </div>
          <div className="flex items-center gap-3">
            <select
              value={tallyId}
              onChange={(e) => {
                const value = e.target.value;
                setTallyId(value);
                save({ tallyId: value || null });
              }}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
            >
              <option value="">未分類</option>
              {tallyOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {isPending && <span className="text-xs text-slate-400">儲存中…</span>}
            {saved && !isPending && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <IconCheckCircle className="h-3.5 w-3.5" />
                已儲存
              </span>
            )}
            <form action={deleteKmEntryAction.bind(null, entry.id)} className="ml-auto">
              <button type="submit" className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700">
                <IconTrash className="h-3.5 w-3.5" />
                刪除
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
