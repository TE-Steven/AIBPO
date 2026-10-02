"use client";

import { useMemo, useState } from "react";
import { stripBotDisclaimer } from "@/lib/botTestShared";
import { accuracyOf, buildComparison, formatDateTime, type CompareRow, type VersionView } from "./knowledgeTypes";

const VERDICT: Record<string, { label: string; className: string }> = {
  MATCH: { label: "一致", className: "bg-emerald-50 text-emerald-600" },
  PARTIAL: { label: "部分一致", className: "bg-amber-50 text-amber-700" },
  MISMATCH: { label: "不一致", className: "bg-rose-50 text-rose-600" },
  ERROR: { label: "比對失敗", className: "bg-slate-100 text-slate-500" },
};

const CHANGE: Record<string, { label: string; className: string }> = {
  improved: { label: "進步", className: "bg-emerald-600 text-white" },
  regressed: { label: "退步", className: "bg-rose-600 text-white" },
  changed: { label: "回答有變", className: "bg-slate-200 text-slate-700" },
};

function Cell({ cell }: { cell: CompareRow["cells"][number] }) {
  const [open, setOpen] = useState(false);
  if (!cell) return <span className="text-xs text-slate-300">沒測到</span>;
  const verdict = cell.judgeVerdict ? VERDICT[cell.judgeVerdict] : null;
  const answer = cell.botAnswer ? stripBotDisclaimer(cell.botAnswer) : null;
  return (
    <div className="space-y-1.5 text-xs">
      {verdict ? (
        <span className={`inline-block rounded-full px-2 py-0.5 font-medium ${verdict.className}`}>{verdict.label}</span>
      ) : (
        <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
          {cell.status === "TIMEOUT" ? "逾時" : cell.status === "PENDING" ? "等待中" : "錯誤"}
        </span>
      )}
      {cell.judgeReason && <p className="text-rose-600">{cell.judgeReason}</p>}
      {answer ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="block text-left text-slate-600 hover:text-slate-900">
          <span className={`whitespace-pre-wrap ${open ? "" : "line-clamp-3"}`}>{answer}</span>
        </button>
      ) : (
        cell.errorMessage && <p className="text-slate-400">{cell.errorMessage}</p>
      )}
    </div>
  );
}

export function ComparePanel({ versions, initialSelected }: { versions: VersionView[]; initialSelected: string[] }) {
  // 只有測過的版本能比較；依建立時間舊→新排列
  const tested = useMemo(
    () => versions.filter((v) => v.latestRun).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [versions],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const valid = initialSelected.filter((id) => tested.some((v) => v.id === id));
    return valid.length > 0 ? valid : tested.slice(-2).map((v) => v.id);
  });
  const [onlyDiff, setOnlyDiff] = useState(false);

  const selected = tested.filter((v) => selectedIds.includes(v.id));
  const rows = useMemo(() => buildComparison(selected), [selected]);
  const shown = onlyDiff ? rows.filter((r) => r.change === "improved" || r.change === "regressed" || r.change === "changed") : rows;
  const improved = rows.filter((r) => r.change === "improved").length;
  const regressed = rows.filter((r) => r.change === "regressed").length;

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (tested.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
        還沒有測試過的版本：到「版本」分頁按「用題庫測試」。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-medium text-slate-500">選擇要比較的版本（依建立時間排列，每個版本用最近一次的測試結果）</p>
        <div className="flex flex-wrap gap-2">
          {tested.map((v) => {
            const acc = accuracyOf(v.latestRun);
            const on = selectedIds.includes(v.id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggle(v.id)}
                aria-pressed={on}
                className={`rounded-lg border px-3 py-1.5 text-left text-xs transition ${
                  on ? "border-teal-400 bg-teal-50 text-teal-800" : "border-slate-200 text-slate-600 hover:border-teal-300"
                }`}
              >
                <span className="font-semibold">{v.name}</span>
                <span className="ml-1.5 tabular-nums">{acc ? `${acc.percent}%` : "—"}</span>
                <span className="ml-1.5 text-slate-400">{formatDateTime(v.latestRun!.createdAt)}</span>
              </button>
            );
          })}
        </div>
        {selected.length >= 2 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-600">
              {selected[selected.length - 2].name} → {selected[selected.length - 1].name}：
              <span className="ml-1 font-semibold text-emerald-600">進步 {improved} 題</span>
              <span className="ml-2 font-semibold text-rose-600">退步 {regressed} 題</span>
            </span>
            <label className="ml-auto flex items-center gap-1.5 text-slate-600">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} className="accent-teal-600" />
              只看有變化的題目
            </label>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full table-fixed text-left text-sm" style={{ minWidth: `${420 + selected.length * 260}px` }}>
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="w-10 px-3 py-2">#</th>
                <th className="w-64 px-3 py-2">題目／標準答案</th>
                {selected.map((v) => {
                  const acc = accuracyOf(v.latestRun);
                  return (
                    <th key={v.id} className="px-3 py-2">
                      <span className="font-semibold text-slate-700">{v.name}</span>
                      {acc && (
                        <span className="ml-1.5 tabular-nums">
                          {acc.percent}%（{acc.matched}/{acc.total}）
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {shown.map((row, i) => (
                <tr key={row.key}>
                  <td className="px-3 py-3 text-xs text-slate-400">{i + 1}</td>
                  <td className="px-3 py-3">
                    <p className="text-sm font-medium text-slate-800">{row.question}</p>
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs text-slate-500">{row.expectedAnswer}</p>
                    {row.change && CHANGE[row.change] && (
                      <span className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${CHANGE[row.change].className}`}>
                        {CHANGE[row.change].label}
                      </span>
                    )}
                  </td>
                  {row.cells.map((cell, ci) => (
                    <td key={selected[ci].id} className="px-3 py-3">
                      <Cell cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={2 + selected.length} className="px-3 py-8 text-center text-sm text-slate-400">
                    {onlyDiff ? "這兩個版本之間沒有變化的題目" : "沒有測試結果"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
