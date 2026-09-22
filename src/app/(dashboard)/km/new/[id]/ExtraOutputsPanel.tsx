"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { generateRagContentAction } from "./ragActions";
import { generateWorkflowDraftsAction } from "./workflowActions";
import { IconCheckCircle, IconAlertTriangle, IconSparkles, IconChevronDown } from "@/components/icons";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  NONE: { label: "尚未產生", className: "bg-slate-100 text-slate-500" },
  PENDING: { label: "等待中", className: "bg-amber-50 text-amber-600" },
  PROCESSING: { label: "產生中…", className: "bg-amber-50 text-amber-600" },
  DONE: { label: "已完成", className: "bg-emerald-50 text-emerald-600" },
  FAILED: { label: "失敗", className: "bg-rose-50 text-rose-600" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.NONE;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

export function ExtraOutputsPanel({
  sourceId,
  ragStatus,
  ragContent,
  ragErrorMessage,
  workflowStatus,
  workflowErrorMessage,
  draftCount,
}: {
  sourceId: string;
  ragStatus: string;
  ragContent: string | null;
  ragErrorMessage: string | null;
  workflowStatus: string;
  workflowErrorMessage: string | null;
  draftCount: number;
}) {
  const router = useRouter();
  const [ragPending, startRag] = useTransition();
  const [workflowPending, startWorkflow] = useTransition();
  const [ragMessage, setRagMessage] = useState<{ success?: string; error?: string }>({});
  const [workflowMessage, setWorkflowMessage] = useState<{ success?: string; error?: string }>({});
  const [copied, setCopied] = useState(false);
  const [ragContentOpen, setRagContentOpen] = useState(false);

  function runRag() {
    setRagMessage({});
    startRag(async () => {
      const result = await generateRagContentAction(sourceId);
      setRagMessage(result);
      router.refresh();
    });
  }

  function runWorkflow() {
    setWorkflowMessage({});
    startWorkflow(async () => {
      const result = await generateWorkflowDraftsAction(sourceId);
      setWorkflowMessage(result);
      router.refresh();
    });
  }

  async function copyRagContent() {
    if (!ragContent) return;
    await navigator.clipboard.writeText(ragContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">RAG 內容</h3>
          <StatusBadge status={ragStatus} />
        </div>
        <p className="mb-3 text-xs text-slate-500">
          把原文重排清理成乾淨版文件（修復分頁斷裂、去除雜訊），適合直接餵給下游 RAG 系統。
        </p>
        <button
          type="button"
          onClick={runRag}
          disabled={ragPending || ragStatus === "PROCESSING"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
        >
          <IconSparkles className="h-3.5 w-3.5" />
          {ragPending ? "產生中…" : ragStatus === "DONE" ? "重新產生" : "產生 RAG 內容"}
        </button>

        {ragErrorMessage && ragStatus === "FAILED" && !ragMessage.error && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-inset ring-rose-100">
            <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {ragErrorMessage}
          </p>
        )}
        {(ragMessage.success || ragMessage.error) && (
          <p
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${
              ragMessage.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
            }`}
          >
            {ragMessage.error ? <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <IconCheckCircle className="h-3.5 w-3.5 shrink-0" />}
            {ragMessage.error ?? ragMessage.success}
          </p>
        )}

        {ragContent && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setRagContentOpen((v) => !v)}
              className="flex w-full items-center justify-between text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              <span>結果（{ragContent.length.toLocaleString()} 字）</span>
              <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${ragContentOpen ? "rotate-180" : ""}`} />
            </button>
            {ragContentOpen && (
              <div className="mt-1.5">
                <div className="mb-1.5 flex justify-end gap-3">
                  <a
                    href={`/api/km/sources/${sourceId}/rag-md`}
                    download
                    className="text-xs font-medium text-teal-600 hover:text-teal-700"
                  >
                    下載 .md
                  </a>
                  <a
                    href={`/api/km/sources/${sourceId}/rag-pdf`}
                    download
                    className="text-xs font-medium text-teal-600 hover:text-teal-700"
                  >
                    下載 PDF
                  </a>
                  <button type="button" onClick={copyRagContent} className="text-xs font-medium text-teal-600 hover:text-teal-700">
                    {copied ? "已複製" : "複製"}
                  </button>
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  {ragContent}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Workflow</h3>
          <StatusBadge status={workflowStatus} />
        </div>
        <p className="mb-3 text-xs text-slate-500">
          辨識文件中的客服情境，從既有 Skill 庫挑選匹配工具，產出待審核的 Agent 草稿。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runWorkflow}
            disabled={workflowPending || workflowStatus === "PROCESSING"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
          >
            <IconSparkles className="h-3.5 w-3.5" />
            {workflowPending ? "產生中…" : workflowStatus === "DONE" ? "重新產生" : "產生 Workflow 草稿"}
          </button>
          {draftCount > 0 && (
            <Link href="/agents/drafts" className="text-xs font-medium text-teal-600 hover:text-teal-700">
              查看 {draftCount} 筆待審核草稿 →
            </Link>
          )}
        </div>

        {workflowErrorMessage && workflowStatus === "FAILED" && !workflowMessage.error && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-inset ring-rose-100">
            <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {workflowErrorMessage}
          </p>
        )}
        {(workflowMessage.success || workflowMessage.error) && (
          <p
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${
              workflowMessage.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
            }`}
          >
            {workflowMessage.error ? <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <IconCheckCircle className="h-3.5 w-3.5 shrink-0" />}
            {workflowMessage.error ?? workflowMessage.success}
          </p>
        )}
      </div>
    </div>
  );
}
