"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconCheckCircle } from "@/components/icons";
import { checkSourceFilesAction, replaceSourceFilesAction, type SourceFileCheck } from "./sourceFileActions";
import { precheckSourceFile, SOURCE_FILE_ACCEPT, uploadSourceFile } from "../uploadClient";

// 來源檔案：列出檔名、檢查在目前的 Claude 工作區還在不在；找不到（換了 API key 的工作區）時可以在原來源上重新上傳
export function SourceFilesCard({
  sourceId,
  files,
  busy,
}: {
  sourceId: string;
  files: { fileName: string; images: number }[];
  // 分析中不能替換
  busy: boolean;
}) {
  const router = useRouter();
  const [check, setCheck] = useState<SourceFileCheck | null>(null);
  const [checkKey, setCheckKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void checkSourceFilesAction(sourceId).then((r) => {
      if (!cancelled) setCheck(r);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId, checkKey]);

  const missing = check?.missing ?? [];
  const broken = missing.length > 0;

  async function replace(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    setSuccess(null);
    const picked = Array.from(list);
    const bad = picked.map((f) => [f.name, precheckSourceFile(f)] as const).find(([, err]) => err);
    if (bad) {
      setError(`「${bad[0]}」${bad[1]}`);
      if (input.current) input.current.value = "";
      return;
    }
    const uploads = [];
    let imagesUsed = 0;
    try {
      for (const [i, file] of picked.entries()) {
        setStatus(`上傳中 ${i + 1}／${picked.length}：${file.name}（Word／Excel 會先轉換，大檔案需要一點時間）`);
        const { upload, stats } = await uploadSourceFile(file, imagesUsed);
        imagesUsed += stats.images;
        uploads.push(upload);
      }
      setStatus("更新來源中…");
      const result = await replaceSourceFilesAction(sourceId, uploads);
      if (result.error) {
        setError(result.error);
        void fetch("/api/km/source-files", { method: "DELETE", body: JSON.stringify({ uploads }) });
      } else {
        setSuccess(result.success ?? "已替換。");
        setOpen(false);
        setCheck(null);
        setCheckKey((k) => k + 1);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗");
      if (uploads.length > 0) void fetch("/api/km/source-files", { method: "DELETE", body: JSON.stringify({ uploads }) });
    } finally {
      setStatus(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${broken ? "border-rose-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">來源檔案</h2>
        {check === null ? (
          <span className="text-xs text-slate-400">檢查檔案中…</span>
        ) : check.error ? (
          <span className="text-xs text-amber-600">無法檢查檔案：{check.error}</span>
        ) : broken ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
            <IconAlertTriangle className="h-3.5 w-3.5" />
            {missing.length}／{check.total} 個檔案找不到
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <IconCheckCircle className="h-3.5 w-3.5" />
            檔案正常
          </span>
        )}
        <button
          type="button"
          disabled={busy || status !== null}
          onClick={() => setOpen((v) => !v)}
          className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            broken ? "bg-rose-600 text-white hover:bg-rose-700" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          重新上傳檔案
        </button>
      </div>

      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <li
              key={f.fileName}
              className={`rounded-md px-2 py-0.5 text-xs ${missing.includes(f.fileName) ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-slate-100 text-slate-600"}`}
            >
              {f.fileName}
              {f.images > 0 && <span className="ml-1 text-slate-400">（{f.images} 張圖）</span>}
            </li>
          ))}
        </ul>
      )}

      {broken && (
        <p className="mt-2 text-xs leading-relaxed text-rose-600">
          這些檔案在目前的 Claude 工作區找不到（通常是 API key 換到不同的工作區），開始分析、產生結構化文件、自動優化的 AI 修改都會失敗。請按「重新上傳檔案」把原始檔再傳一次，FAQ、結構化文件、優化任務與版本都會保留。
        </p>
      )}

      {open && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-2 text-xs text-slate-500">
            選擇這個來源的所有檔案（可多選）。上傳完成後會<strong>取代</strong>上面列出的檔案；網址不受影響，已經產生的結果都會保留。
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept={SOURCE_FILE_ACCEPT}
            disabled={status !== null}
            onChange={(e) => void replace(e.target.files)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          {status && (
            <p className="mt-2 flex items-center gap-2 text-xs font-medium text-teal-700">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-200 border-t-teal-600" />
              {status}
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      {success && <p className="mt-2 text-xs text-emerald-600">{success}</p>}
    </div>
  );
}
