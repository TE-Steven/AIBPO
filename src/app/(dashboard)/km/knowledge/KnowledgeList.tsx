"use client";

import { useMemo, useState, useTransition } from "react";
import { EntryCard, type KmEntryLike } from "../EntryCard";
import { createVersionAction, addToTestBankAction, removeEntriesAction } from "./actions";
import { IconAlertTriangle, IconCheckCircle, IconChevronDown, IconTrash, IconX } from "@/components/icons";

type Entry = KmEntryLike & { tallyId: string | null; sourceId: string; sourceTitle: string };

export function KnowledgeList({
  entries,
  tallyOptions,
  sourceOptions,
  onVersionCreated,
}: {
  entries: Entry[];
  tallyOptions: { id: string; label: string }[];
  sourceOptions: { id: string; title: string }[];
  // 建立版本後切到「版本」分頁
  onVersionCreated?: () => void;
}) {
  const [tallyFilter, setTallyFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandVersion, setExpandVersion] = useState(0);

  function toggleExpandAll() {
    setAllExpanded((prev) => !prev);
    setExpandVersion((v) => v + 1);
  }

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

  const exportHref = (format: "md" | "pdf" | "xlsx") => `/api/km/export?format=${format}&ids=${Array.from(selected).join(",")}`;

  // ---- 建立版本／加入測試題庫 ----
  const [versionModal, setVersionModal] = useState(false);
  const [versionName, setVersionName] = useState("");
  const [versionNote, setVersionNote] = useState("");
  const [includeFaq, setIncludeFaq] = useState(true);
  const [includeDocs, setIncludeDocs] = useState(true);
  const [message, setMessage] = useState<{ success?: string; error?: string }>({});
  const [pending, startTransition] = useTransition();
  const selectedEntries = entries.filter((e) => selected.has(e.id));
  const selectedFaqCount = selectedEntries.filter((e) => e.kind !== "DOC").length;
  const selectedDocCount = selectedEntries.length - selectedFaqCount;

  function createVersion() {
    startTransition(async () => {
      const result = await createVersionAction({
        entryIds: Array.from(selected),
        name: versionName,
        note: versionNote,
        includeFaq,
        includeDocs,
      });
      setMessage(result);
      if (result.success) {
        setVersionModal(false);
        setVersionName("");
        setVersionNote("");
        onVersionCreated?.();
      }
    });
  }

  // ---- 刪除：移出知識列表或永久刪除 ----
  const [removeModal, setRemoveModal] = useState(false);
  const [removeMode, setRemoveMode] = useState<"unconfirm" | "delete">("unconfirm");

  function removeEntries() {
    startTransition(async () => {
      const result = await removeEntriesAction(Array.from(selected), removeMode);
      setMessage(result);
      if (result.success) {
        setRemoveModal(false);
        setSelected(new Set());
      }
    });
  }

  function addToTestBank() {
    startTransition(async () => {
      setMessage(await addToTestBankAction(Array.from(selected)));
    });
  }

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
        <button
          type="button"
          onClick={toggleExpandAll}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          <IconChevronDown className={`h-4 w-4 transition-transform ${allExpanded ? "rotate-180" : ""}`} />
          {allExpanded ? "全部收合" : "全部展開"}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMessage({});
              setVersionModal(true);
            }}
            disabled={selected.size === 0}
            className="rounded-lg border border-teal-300 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
          >
            建立版本
          </button>
          <button
            type="button"
            onClick={addToTestBank}
            disabled={selectedFaqCount === 0 || pending}
            title={selectedFaqCount === 0 ? "請勾選 FAQ（結構化文件不適合當測試題）" : undefined}
            className="rounded-lg border border-teal-300 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
          >
            加入測試題庫
          </button>
          <button
            type="button"
            onClick={() => {
              setMessage({});
              setRemoveMode("unconfirm");
              setRemoveModal(true);
            }}
            disabled={selected.size === 0 || pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
          >
            <IconTrash className="h-4 w-4" />
            刪除
          </button>
          {(["md", "pdf", "xlsx"] as const).map((format) => (
            <a
              key={format}
              href={selected.size > 0 ? exportHref(format) : undefined}
              aria-disabled={selected.size === 0}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
                selected.size > 0
                  ? "bg-gradient-to-r from-teal-600 to-cyan-500 shadow-teal-500/25 hover:from-teal-700 hover:to-cyan-600"
                  : "cursor-not-allowed bg-slate-300"
              }`}
            >
              {format === "md" ? "匯出所選為 .md" : format === "pdf" ? "匯出所選為 PDF" : "匯出所選為 Excel"}
            </a>
          ))}
        </div>
      </div>

      {(message.success || message.error) && (
        <p
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
            message.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
          }`}
        >
          {message.error ? <IconAlertTriangle className="h-4 w-4 shrink-0" /> : <IconCheckCircle className="h-4 w-4 shrink-0" />}
          {message.error ?? message.success}
        </p>
      )}

      {removeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setRemoveModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">刪除 {selected.size} 題</h3>
              <button type="button" onClick={() => setRemoveModal(false)} aria-label="關閉" className="text-slate-400 hover:text-slate-600">
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {(
                [
                  { value: "unconfirm", label: "移出知識列表", desc: "題目仍留在 KM 來源裡，之後可以在來源頁重新勾選加回來。" },
                  { value: "delete", label: "永久刪除", desc: "題目從系統刪除，KM 來源裡也看不到，無法復原。" },
                ] as const
              ).map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    removeMode === o.value ? (o.value === "delete" ? "border-rose-300 bg-rose-50/60" : "border-teal-300 bg-teal-50/60") : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="remove-mode"
                    checked={removeMode === o.value}
                    onChange={() => setRemoveMode(o.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className={`block text-sm font-semibold ${o.value === "delete" ? "text-rose-700" : "text-slate-800"}`}>{o.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{o.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">已建立的版本與測試題庫存的是當時的內容，不受影響。</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setRemoveModal(false)} className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700">
                取消
              </button>
              <button
                type="button"
                onClick={removeEntries}
                disabled={pending}
                className={`rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50 ${
                  removeMode === "delete" ? "bg-rose-600 hover:bg-rose-700" : "bg-gradient-to-r from-teal-600 to-cyan-500"
                }`}
              >
                {pending ? "處理中…" : removeMode === "delete" ? `永久刪除 ${selected.size} 題` : `移出 ${selected.size} 題`}
              </button>
            </div>
          </div>
        </div>
      )}

      {versionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setVersionModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">建立知識庫版本</h3>
              <button type="button" onClick={() => setVersionModal(false)} aria-label="關閉" className="text-slate-400 hover:text-slate-600">
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              把勾選的 {selected.size} 題（FAQ {selectedFaqCount}、結構化文件 {selectedDocCount}）凍結成一個版本，並記下目前的 Prompt 設定與分類描述。之後題目再怎麼改，這一版的內容都不會變。
            </p>
            <label className="mb-1 block text-sm font-medium text-slate-700">版本名稱</label>
            <input
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              placeholder="留空自動命名（v1、v2…）"
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
            <label className="mb-1 block text-sm font-medium text-slate-700">備註（選填）</label>
            <textarea
              value={versionNote}
              onChange={(e) => setVersionNote(e.target.value)}
              rows={2}
              placeholder="例：分類補上描述、FAQ 口吻改成中立"
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
            <div className="mb-4 flex gap-5 text-sm text-slate-700">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={includeFaq} onChange={(e) => setIncludeFaq(e.target.checked)} className="accent-teal-600" />
                包含 FAQ
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={includeDocs} onChange={(e) => setIncludeDocs(e.target.checked)} className="accent-teal-600" />
                包含結構化文件
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setVersionModal(false)} className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700">
                取消
              </button>
              <button
                type="button"
                onClick={createVersion}
                disabled={pending || (!includeFaq && !includeDocs)}
                className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
              >
                {pending ? "建立中…" : "建立版本"}
              </button>
            </div>
          </div>
        </div>
      )}

      {filtered.map((entry) => (
        <EntryCard
          key={`${entry.id}-${expandVersion}`}
          entry={entry}
          tallyOptions={tallyOptions}
          checked={selected.has(entry.id)}
          onToggle={() => toggle(entry.id)}
          badge={<span className="block text-xs text-slate-400">來源：{entry.sourceTitle}</span>}
          collapsible
          defaultExpanded={allExpanded}
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
