"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconCheckCircle, IconSparkles } from "@/components/icons";
import { OutputStatusBadge } from "./OutputStatusBadge";
import { StuckNotice } from "./StuckNotice";
import { stopDocumentsAction } from "./actions";

// 第三張產出卡片：依分類範本產生結構化文件（跟 RAG 內容、Workflow 同一種操作方式）。
// 每個實體一筆（在題目列表的「結構化文件」分頁編輯、確認），這裡另外提供整份下載。
export function DocumentsCard({
  sourceId,
  status,
  errorMessage,
  count,
  templateNames,
  elapsedMinutes,
}: {
  sourceId: string;
  status: string;
  errorMessage: string | null;
  count: number;
  templateNames: string[];
  elapsedMinutes: number | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [message, setMessage] = useState<{ success?: string; error?: string }>({});
  const [stopping, startStop] = useTransition();
  const esRef = useRef<EventSource | null>(null);
  const hasTemplates = templateNames.length > 0;

  function run() {
    setConfirming(false);
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
      const { docCount } = JSON.parse((e as MessageEvent).data);
      setMessage({ success: `已產生 ${docCount} 份結構化文件，請到下方題目列表的「結構化文件」分頁檢視與確認。` });
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
      router.refresh();
    });
  }

  function stop() {
    setMessage({});
    startStop(async () => {
      setMessage(await stopDocumentsAction(sourceId));
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">結構化文件</h3>
        <OutputStatusBadge status={running ? "PROCESSING" : status} />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {hasTemplates
          ? `依「${templateNames.join("」「")}」範本，找出文件裡每一個項目，各整理成一份依維度排好的文件。`
          : "依分類範本，找出文件裡每一個項目，各整理成一份依維度排好的文件。"}
      </p>

      {!hasTemplates && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-100">
          目前沒有文件範本：請先到「分類管理」，在大分類底下加上子分類（維度）。
        </p>
      )}

      {confirming ? (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
          <p>會用新的結果取代現有的 {count} 份結構化文件（包含已經確認進知識列表的）；新的產生失敗時會保留舊的。</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={run}
              className="rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white transition hover:bg-amber-700"
            >
              確定重新產生
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="font-medium text-slate-500 hover:text-slate-700">
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (count > 0 ? setConfirming(true) : run())}
          disabled={running || status === "PROCESSING" || !hasTemplates}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
        >
          <IconSparkles className="h-3.5 w-3.5" />
          {running ? "產生中…" : count > 0 ? "重新產生" : "產生結構化文件"}
        </button>
      )}

      {running && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-300">
          {thinkingText || "AI 正在閱讀文件、找出每一個項目…"}
        </div>
      )}
      {status === "PROCESSING" && !running && <StuckNotice elapsedMinutes={elapsedMinutes} onStop={stop} stopping={stopping} />}

      {errorMessage && !running && !message.success && !message.error && (
        <p
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${
            status === "FAILED" ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-amber-50 text-amber-700 ring-amber-100"
          }`}
        >
          <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {status === "FAILED" ? errorMessage : `上次重新產生沒有成功，保留舊版：${errorMessage}`}
        </p>
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

      {count > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-500">結果（{count} 份，每份一個 H1）</span>
          <div className="flex gap-3">
            <a href={`/api/km/sources/${sourceId}/documents/download`} download className="font-medium text-teal-600 hover:text-teal-700">
              下載整份 .md
            </a>
            <a
              href={`/api/km/sources/${sourceId}/documents/download?format=pdf`}
              download
              className="font-medium text-teal-600 hover:text-teal-700"
            >
              下載整份 PDF
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
