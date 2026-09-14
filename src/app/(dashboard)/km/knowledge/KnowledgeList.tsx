"use client";

import { useMemo, useState } from "react";
import { EntryCard, type KmEntryLike } from "../EntryCard";

type Entry = KmEntryLike & { tallyId: string | null; sourceId: string; sourceTitle: string };

export function KnowledgeList({
  entries,
  tallyOptions,
  sourceOptions,
}: {
  entries: Entry[];
  tallyOptions: { id: string; label: string }[];
  sourceOptions: { id: string; title: string }[];
}) {
  const [tallyFilter, setTallyFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (tallyFilter === "none" && e.tallyId) return false;
      if (tallyFilter !== "all" && tallyFilter !== "none" && e.tallyId !== tallyFilter) return false;
      if (sourceFilter !== "all" && e.sourceId !== sourceFilter) return false;
      return true;
    });
  }, [entries, tallyFilter, sourceFilter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((e) => e.id))));
  }

  const exportHref = `/api/km/export?ids=${Array.from(selected).join(",")}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-slate-700">依分類篩選</label>
          <select
            value={tallyFilter}
            onChange={(e) => {
              setTallyFilter(e.target.value);
              setSelected(new Set());
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
          >
            <option value="all">全部分類</option>
            <option value="none">未分類</option>
            {tallyOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>

          <label className="text-sm font-medium text-slate-700">依來源篩選</label>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setSelected(new Set());
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
          >
            <option value="all">全部來源</option>
            {sourceOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={selected.size === filtered.length && filtered.length > 0}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
          />
          全選（已選 {selected.size} / {filtered.length}）
        </label>
        <a
          href={selected.size > 0 ? exportHref : undefined}
          aria-disabled={selected.size === 0}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
            selected.size > 0
              ? "bg-gradient-to-r from-teal-600 to-cyan-500 shadow-teal-500/25 hover:from-teal-700 hover:to-cyan-600"
              : "cursor-not-allowed bg-slate-300"
          }`}
        >
          匯出所選為 .md
        </a>
      </div>

      {filtered.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          tallyOptions={tallyOptions}
          checked={selected.has(entry.id)}
          onToggle={() => toggle(entry.id)}
          badge={<span className="block text-xs text-slate-400">來源：{entry.sourceTitle}</span>}
        />
      ))}

      {filtered.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
          {entries.length === 0 ? "還沒有任何知識被加入列表" : "這個分類底下沒有項目"}
        </div>
      )}
    </div>
  );
}
