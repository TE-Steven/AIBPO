"use client";

import { useActionState, useState } from "react";
import { createPdfSourceAction, createUrlSourceAction, type CreateSourceState } from "./actions";
import { IconAlertTriangle } from "@/components/icons";

const initialState: CreateSourceState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100";

function ErrorMessage({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-100">
      <IconAlertTriangle className="h-4 w-4 shrink-0" />
      {error}
    </p>
  );
}

export function UploadWizard() {
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<"PDF" | "URL">("PDF");
  const [pdfState, pdfAction, pdfPending] = useActionState(createPdfSourceAction, initialState);
  const [urlState, urlAction, urlPending] = useActionState(createUrlSourceAction, initialState);

  const canSubmit = title.trim().length > 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">步驟 1：輸入名稱</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          type="text"
          placeholder="例如：吹風機退換貨政策"
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">步驟 2：選擇來源</label>
        <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setSourceType("PDF")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              sourceType === "PDF" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"
            }`}
          >
            上傳 PDF
          </button>
          <button
            type="button"
            onClick={() => setSourceType("URL")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              sourceType === "URL" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"
            }`}
          >
            貼上網址
          </button>
        </div>

        {sourceType === "PDF" ? (
          <form action={pdfAction} className="space-y-3">
            <input type="hidden" name="title" value={title} />
            <input name="file" type="file" accept="application/pdf" required className={inputClass} />
            <ErrorMessage error={pdfState.error} />
            <button
              type="submit"
              disabled={!canSubmit || pdfPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 transition hover:from-violet-700 hover:to-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pdfPending ? "上傳中…" : "上傳並建立來源"}
            </button>
          </form>
        ) : (
          <form action={urlAction} className="space-y-3">
            <input type="hidden" name="title" value={title} />
            <input name="url" type="url" placeholder="https://example.com/article" required className={inputClass} />
            <ErrorMessage error={urlState.error} />
            <button
              type="submit"
              disabled={!canSubmit || urlPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 transition hover:from-violet-700 hover:to-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {urlPending ? "建立中…" : "建立來源"}
            </button>
          </form>
        )}
        {!canSubmit && <p className="mt-2 text-xs text-slate-400">請先在步驟 1 輸入名稱，才能建立來源。</p>}
      </div>
    </div>
  );
}
