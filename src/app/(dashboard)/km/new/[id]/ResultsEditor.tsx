"use client";

import { useState, useTransition } from "react";
import { setKmEntriesConfirmedAction } from "../../entryActions";
import { EntryCard, type KmEntryLike } from "../../EntryCard";
import { IconCheckCircle, IconChevronDown } from "@/components/icons";

type Entry = KmEntryLike & { confirmed: boolean };

export function ResultsEditor({
  entries: allEntries,
  tallyOptions,
}: {
  entries: Entry[];
  tallyOptions: { id: string; label: string }[];
}) {
  // 分頁：FAQ 與結構化文件分開勾選、確認（沒有結構化文件時不顯示分頁）
  const faqEntries = allEntries.filter((e) => e.kind !== "DOC");
  const docEntries = allEntries.filter((e) => e.kind === "DOC");
  const [tab, setTab] = useState<"FAQ" | "DOC">("FAQ");
  const activeTab = tab === "DOC" && docEntries.length > 0 ? "DOC" : "FAQ";
  const entries = activeTab === "DOC" ? docEntries : faqEntries;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set(allEntries.filter((e) => e.confirmed).map((e) => e.id)));
  const [isPending, startTransition] = useTransition();
  const [justConfirmed, setJustConfirmed] = useState(false);
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandVersion, setExpandVersion] = useState(0);

  function toggleExpandAll() {
    setAllExpanded((prev) => !prev);
    setExpandVersion((v) => v + 1);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function switchTab(next: "FAQ" | "DOC") {
    setTab(next);
    setSelected(new Set());
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === entries.length ? new Set() : new Set(entries.map((e) => e.id))));
  }

  function confirmSelected() {
    const ids = Array.from(selected);
    startTransition(async () => {
      await setKmEntriesConfirmedAction(ids, true);
      setConfirmedIds((prev) => new Set([...prev, ...ids]));
      setJustConfirmed(true);
      setTimeout(() => setJustConfirmed(false), 2000);
    });
  }

  return (
    <div className="space-y-3">
      {docEntries.length > 0 && (
        <div className="flex gap-1 border-b border-slate-200" role="tablist">
          {(
            [
              ["FAQ", `FAQ（${faqEntries.length}）`],
              ["DOC", `結構化文件（${docEntries.length}）`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => switchTab(id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                activeTab === id ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={selected.size === entries.length && entries.length > 0}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
          />
          全選（已選 {selected.size} / {entries.length}）
        </label>
        <button
          type="button"
          onClick={toggleExpandAll}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          <IconChevronDown className={`h-4 w-4 transition-transform ${allExpanded ? "rotate-180" : ""}`} />
          {allExpanded ? "全部收合" : "全部展開"}
        </button>
        <div className="flex items-center gap-3">
          {justConfirmed && (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <IconCheckCircle className="h-3.5 w-3.5" />
              已加入知識列表
            </span>
          )}
          <button
            type="button"
            onClick={confirmSelected}
            disabled={selected.size === 0 || isPending}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
              selected.size > 0 && !isPending
                ? "bg-gradient-to-r from-teal-600 to-cyan-500 shadow-teal-500/25 hover:from-teal-700 hover:to-cyan-600"
                : "cursor-not-allowed bg-slate-300"
            }`}
          >
            {isPending ? "處理中…" : "加入知識列表"}
          </button>
        </div>
      </div>

      {entries.map((entry) => (
        <EntryCard
          key={`${entry.id}-${expandVersion}`}
          entry={entry}
          tallyOptions={tallyOptions}
          checked={selected.has(entry.id)}
          onToggle={() => toggle(entry.id)}
          collapsible
          defaultExpanded={allExpanded}
          badge={
            confirmedIds.has(entry.id) ? (
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                <IconCheckCircle className="h-3 w-3" />
                已在知識列表
              </span>
            ) : undefined
          }
        />
      ))}

      {entries.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
          {activeTab === "DOC" ? "還沒有結構化文件" : "還沒有產出任何 FAQ"}
        </div>
      )}
    </div>
  );
}
