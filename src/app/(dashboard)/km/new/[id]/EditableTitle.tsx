"use client";

import { useState, useTransition } from "react";
import { updateKmSourceTitleAction } from "./actions";
import { IconPencil, IconCheckCircle } from "@/components/icons";

export function EditableTitle({ sourceId, initialTitle }: { sourceId: string; initialTitle: string }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    const trimmed = title.trim();
    setEditing(false);
    if (!trimmed || trimmed === initialTitle) {
      setTitle(initialTitle);
      return;
    }
    startTransition(async () => {
      await updateKmSourceTitleAction(sourceId, trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setTitle(initialTitle);
            setEditing(false);
          }
        }}
        className="w-full rounded-lg border border-teal-300 px-2.5 py-1 text-xl font-semibold text-slate-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
      />
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex max-w-full items-center gap-2 text-left">
      <h1 className="truncate text-xl font-semibold text-slate-900">{title}</h1>
      <IconPencil className="h-4 w-4 shrink-0 text-slate-300 opacity-0 transition group-hover:opacity-100" />
      {isPending && <span className="shrink-0 text-xs text-slate-400">儲存中…</span>}
      {saved && !isPending && <IconCheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
    </button>
  );
}
