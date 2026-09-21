"use client";

import { useActionState, useState } from "react";
import { createSourceAction, type CreateSourceState } from "./actions";
import { IconAlertTriangle, IconPlus, IconTrash } from "@/components/icons";

const initialState: CreateSourceState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

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
  const [urlRows, setUrlRows] = useState<string[]>([""]);
  const [state, formAction, pending] = useActionState(createSourceAction, initialState);

  const canSubmit = title.trim().length > 0;

  return (
    <div>
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

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="title" value={title} />

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">步驟 2：上傳 PDF（選填，可多選）</label>
          <input name="file" type="file" accept="application/pdf" multiple className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">可以一次選取多個 PDF。</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">步驟 3：貼上網址（選填，可多筆）</label>
          <div className="space-y-2">
            {urlRows.map((url, i) => (
              <div key={i} className="flex gap-2">
                <input
                  name="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrlRows((prev) => prev.map((u, idx) => (idx === i ? e.target.value : u)))}
                  placeholder="https://example.com/article"
                  className={inputClass}
                />
                {urlRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setUrlRows((prev) => prev.filter((_, idx) => idx !== i))}
                    className="shrink-0 rounded-lg p-2 text-rose-500 hover:bg-rose-50"
                  >
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

        <p className="text-xs text-slate-400">PDF 和網址可以同時選填，全部會合併成同一個知識來源一起分析。</p>

        <ErrorMessage error={state.error} />

        <button
          type="submit"
          disabled={!canSubmit || pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "建立中…" : "建立來源"}
        </button>
        {!canSubmit && <p className="mt-2 text-xs text-slate-400">請先在步驟 1 輸入名稱，才能建立來源。</p>}
      </form>
    </div>
  );
}
