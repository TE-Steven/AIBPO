"use client";

import { useActionState } from "react";
import { createPdfSourceAction, createUrlSourceAction, type CreateSourceState } from "./actions";
import { IconAlertTriangle, IconPlus } from "@/components/icons";

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

export function UploadPdfForm() {
  const [state, formAction, pending] = useActionState(createPdfSourceAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <label className="mb-1.5 block text-sm font-medium text-slate-700">上傳 PDF</label>
      <input name="file" type="file" accept="application/pdf" required className={inputClass} />
      <ErrorMessage error={state.error} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 transition hover:from-violet-700 hover:to-indigo-600 disabled:opacity-50"
      >
        <IconPlus className="h-4 w-4" />
        {pending ? "上傳中…" : "上傳並建立來源"}
      </button>
    </form>
  );
}

export function UploadUrlForm() {
  const [state, formAction, pending] = useActionState(createUrlSourceAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <label className="mb-1.5 block text-sm font-medium text-slate-700">網址</label>
      <input name="url" type="url" placeholder="https://example.com/article" required className={inputClass} />
      <ErrorMessage error={state.error} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 transition hover:from-violet-700 hover:to-indigo-600 disabled:opacity-50"
      >
        <IconPlus className="h-4 w-4" />
        {pending ? "建立中…" : "建立來源"}
      </button>
    </form>
  );
}
