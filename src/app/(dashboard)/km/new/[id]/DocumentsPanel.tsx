"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconCheckCircle, IconSparkles } from "@/components/icons";

// 依分類範本（重新）產生結構化文件。新的產生成功才會取代舊的，FAQ 不受影響。
export function DocumentsPanel({
  sourceId,
  templateNames,
  docCount,
  lastError,
}: {
  sourceId: string;
  templateNames: string[];
  docCount: number;
  // 分析時結構化文件沒有產生成功的原因
  lastError: string | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [message, setMessage] = useState<{ success?: string; error?: string }>({});
  const esRef = useRef<EventSource | null>(null);

  function run() {
    if (
      docCount > 0 &&
      !window.confirm(`會用新的結果取代這個來源現有的 ${docCount} 份結構化文件（包含已經確認進知識列表的）。確定要重新產生嗎？`)
    ) {
      return;
    }
    setRunning(true);
    setThinkingText("");
    setMessage({});

    const es = new EventSource(`/api/km/sources/${sourceId}/documents`);
    esRef.current = es;
    es.addEventListener("thinking", (e) => {
      const { text } = JSON.parse((e as MessageEvent).data);
      setThinkingText((prev) => (prev + text).slice(-2000));
    });
    es.addEventListener("done", (e) => {
      const { docCount: count } = JSON.parse((e as MessageEvent).data);
      setMessage({ success: `已產生 ${count} 份結構化文件，記得在下方題目列表勾選確認。` });
      setRunning(false);
      es.close();
      router.refresh();
    });
    es.addEventListener("error", (e) => {
      try {
        setMessage({ error: JSON.parse((e as MessageEvent).data).message });
      } catch {
        setMessage({ error: "連線中斷，請重試一次。" });
      }
      setRunning(false);
      es.close();
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">結構化文件</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            依「{templateNames.join("」「")}」範本整理，目前有 {docCount} 份。改了分類範本、或上次產生失敗時可以重新產生。
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
        >
          <IconSparkles className="h-3.5 w-3.5" />
          {running ? "產生中…" : docCount > 0 ? "重新產生結構化文件" : "產生結構化文件"}
        </button>
      </div>
      {lastError && !running && !message.success && !message.error && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-100">
          <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {lastError}
        </p>
      )}
      {running && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-300">
          {thinkingText || "AI 正在閱讀文件、找出所有實體…"}
        </div>
      )}
      {(message.success || message.error) && (
        <p
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${
            message.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
          }`}
        >
          {message.error ? <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <IconCheckCircle className="h-3.5 w-3.5 shrink-0" />}
          {message.error ?? message.success}
        </p>
      )}
    </div>
  );
}
