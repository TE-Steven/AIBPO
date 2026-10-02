"use client";

import { useRef, useState } from "react";
import { createSourceAction } from "./actions";
import { IconAlertTriangle, IconCheckCircle, IconPlus, IconTrash, IconX } from "@/components/icons";
import { checkTotals, formatBytes, MAX_IMAGES, MAX_PDF_PAGES, TOKEN_BUDGET, type FileStats } from "@/lib/sourceLimits";
import type { SignedUpload } from "@/lib/sourceUpload";
import { fileStatsText, precheckSourceFile, SOURCE_FILE_ACCEPT, uploadSourceFile } from "./uploadClient";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

type Row = {
  file: File;
  status: "waiting" | "uploading" | "done" | "error";
  error?: string;
  upload?: SignedUpload;
  stats?: FileStats;
};

export function UploadWizard() {
  const [title, setTitle] = useState("");
  const [urlRows, setUrlRows] = useState<string[]>([""]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<null | "uploading" | "creating">(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const doneStats = rows.flatMap((r) => (r.stats ? [r.stats] : []));
  const totals = checkTotals(doneStats);
  const prechecked = rows.map((r) => precheckSourceFile(r.file));
  const hasBlocked = prechecked.some(Boolean);
  const canSubmit = title.trim().length > 0 && !hasBlocked && busy === null;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).map((file): Row => ({ file, status: "waiting" }));
    setRows((cur) => [...cur, ...incoming.filter((r) => !cur.some((c) => c.file.name === r.file.name && c.file.size === r.file.size))]);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeRow(i: number) {
    const row = rows[i];
    // 已上傳的檔案從 Claude 刪掉
    if (row.upload) void fetch("/api/km/source-files", { method: "DELETE", body: JSON.stringify({ uploads: [row.upload] }) });
    setRows((cur) => cur.filter((_, j) => j !== i));
  }

  async function submit() {
    setError(null);
    setBusy("uploading");
    const current = [...rows];
    let imagesUsed = current.reduce((n, r) => n + (r.stats?.images ?? 0), 0);
    // 一個一個上傳（已經成功的不重傳）；某個檔案失敗就停下來，修正後可以按「建立來源」接著傳
    for (let i = 0; i < current.length; i++) {
      if (current[i].status === "done") continue;
      current[i] = { ...current[i], status: "uploading", error: undefined };
      setRows([...current]);
      try {
        const { upload, stats } = await uploadSourceFile(current[i].file, imagesUsed);
        current[i] = { ...current[i], status: "done", upload, stats };
        imagesUsed += stats.images;
      } catch (err) {
        current[i] = { ...current[i], status: "error", error: err instanceof Error ? err.message : "上傳失敗" };
        setRows([...current]);
        setError("有檔案上傳失敗，請移除或修正後再按一次「建立來源」（已上傳成功的不會重傳）。");
        setBusy(null);
        return;
      }
      setRows([...current]);
    }

    const check = checkTotals(current.flatMap((r) => (r.stats ? [r.stats] : [])));
    if (check.level === "over") {
      setError(check.message);
      setBusy(null);
      return;
    }

    setBusy("creating");
    const result = await createSourceAction({
      title,
      urls: urlRows,
      uploads: current.flatMap((r) => (r.upload ? [r.upload] : [])),
    });
    // 成功時會直接跳到來源頁；回來表示有錯
    if (result?.error) setError(result.error);
    setBusy(null);
  }

  return (
    <div>
      <div className="mb-6">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">步驟 1：輸入名稱</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} type="text" placeholder="例如：吹風機退換貨政策" className={inputClass} />
      </div>

      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">步驟 2：上傳檔案（選填，可多選）</label>
          <input ref={fileInput} type="file" accept={SOURCE_FILE_ACCEPT} multiple onChange={(e) => addFiles(e.target.files)} disabled={busy !== null} className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">
            支援 PDF（單檔 32MB 內）、Word（.docx）、Excel（.xlsx）（單檔 50MB 內）、文字檔（.txt／.csv），可以分次加入多個檔案。Word／Excel 會轉成文字給 AI
            讀（保留標題、清單、表格），裡面的圖片也會一起附上；舊版 .doc／.xls 請先另存新格式。
          </p>

          {rows.length > 0 && (
            <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {rows.map((r, i) => {
                const blocked = prechecked[i];
                return (
                  <div key={`${r.file.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-5 shrink-0 text-center">
                      {r.status === "done" ? (
                        <IconCheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : r.status === "uploading" ? (
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
                      ) : r.status === "error" || blocked ? (
                        <IconAlertTriangle className="h-4 w-4 text-rose-500" />
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full bg-slate-300" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-slate-800">{r.file.name}</p>
                      <p className={`text-xs ${blocked || r.status === "error" ? "text-rose-600" : "text-slate-400"}`}>
                        {formatBytes(r.file.size)}
                        {r.stats && `・${fileStatsText(r.stats)}`}
                        {r.status === "uploading" && "・上傳中…"}
                        {blocked && `・${blocked}`}
                        {r.status === "error" && r.error && `・${r.error}`}
                      </p>
                    </div>
                    {busy === null && (
                      <button type="button" onClick={() => removeRow(i)} aria-label={`移除 ${r.file.name}`} className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-50 hover:text-rose-600">
                        <IconX className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {doneStats.length > 0 && (
                <div className="space-y-1.5 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0">AI 一次可讀的分量</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${totals.level === "over" ? "bg-rose-500" : totals.level === "warn" ? "bg-amber-400" : "bg-teal-500"}`}
                        style={{ width: `${Math.min(100, Math.max(2, totals.percent))}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{totals.percent}%</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    已上傳：PDF {totals.pages}／{MAX_PDF_PAGES} 頁、圖片 {totals.images}／{MAX_IMAGES} 張、估計 {Math.round(totals.estTokens / 10000)}／
                    {TOKEN_BUDGET / 10000} 萬 token
                  </p>
                  {totals.message && <p className={totals.level === "over" ? "text-rose-600" : "text-amber-700"}>{totals.message}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">步驟 3：貼上網址（選填，可多筆）</label>
          <div className="space-y-2">
            {urlRows.map((url, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrlRows((prev) => prev.map((u, idx) => (idx === i ? e.target.value : u)))}
                  placeholder="https://example.com/article"
                  className={inputClass}
                />
                {urlRows.length > 1 && (
                  <button type="button" onClick={() => setUrlRows((prev) => prev.filter((_, idx) => idx !== i))} className="shrink-0 rounded-lg p-2 text-rose-500 hover:bg-rose-50">
                    <IconTrash className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setUrlRows((prev) => [...prev, ""])}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
          >
            <IconPlus className="h-3.5 w-3.5" />
            新增一個網址
          </button>
        </div>

        <p className="text-xs text-slate-400">檔案和網址可以同時選填，全部會合併成同一個知識來源一起分析。</p>

        {error && (
          <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-100">
            <IconAlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "uploading"
            ? `上傳中 ${rows.filter((r) => r.status === "done").length + 1}／${rows.length}…`
            : busy === "creating"
              ? "建立中…"
              : "建立來源"}
        </button>
        {!title.trim() && <p className="mt-2 text-xs text-slate-400">請先在步驟 1 輸入名稱，才能建立來源。</p>}
        {hasBlocked && <p className="mt-2 text-xs text-rose-600">有檔案不符合格式或大小限制，請先移除。</p>}
      </div>
    </div>
  );
}
