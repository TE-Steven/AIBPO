"use client";

import { useState, useTransition } from "react";
import { confirmAgentDraftAction, rejectAgentDraftAction } from "./actions";
import { IconCheckCircle, IconAlertTriangle, IconTrash, IconSparkles } from "@/components/icons";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export type DraftSkillOption = { id: string; name: string };

export function DraftCard({
  draft,
  skillOptions,
}: {
  draft: {
    id: string;
    sourceTitle: string;
    suggestedName: string;
    suggestedPrompt: string;
    suggestedSkillIds: string[];
    unmatchedNote: string | null;
  };
  skillOptions: DraftSkillOption[];
}) {
  const [name, setName] = useState(draft.suggestedName);
  const [prompt, setPrompt] = useState(draft.suggestedPrompt);
  const [selected, setSelected] = useState<Set<string>>(new Set(draft.suggestedSkillIds));
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ success?: string; error?: string }>({});
  const [done, setDone] = useState(false);

  function toggleSkill(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmAgentDraftAction(draft.id, { name, systemPrompt: prompt, skillIds: Array.from(selected) });
      setStatus(result);
      if (result.success) setDone(true);
    });
  }

  function handleReject() {
    startTransition(async () => {
      await rejectAgentDraftAction(draft.id);
      setDone(true);
    });
  }

  if (done) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-3 text-xs text-slate-400">來源：{draft.sourceTitle}</p>

      <div className="mb-3">
        <label className="mb-1.5 block text-xs font-medium text-slate-700">建議名稱</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-xs font-medium text-slate-700">建議系統提示詞</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className={inputClass} />
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-xs font-medium text-slate-700">掛載 Skill</label>
        <div className="flex flex-wrap gap-2">
          {skillOptions.map((s) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                selected.has(s.id) ? "border-teal-400 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggleSkill(s.id)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
              />
              {s.name}
            </label>
          ))}
          {skillOptions.length === 0 && <p className="text-xs text-slate-400">目前沒有任何 Skill</p>}
        </div>
      </div>

      {draft.unmatchedNote && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-100">
          <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {draft.unmatchedNote}
        </p>
      )}

      {(status.success || status.error) && (
        <p
          className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${
            status.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
          }`}
        >
          {status.error ? <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <IconCheckCircle className="h-3.5 w-3.5 shrink-0" />}
          {status.error ?? status.success}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
        >
          <IconSparkles className="h-3.5 w-3.5" />
          {pending ? "處理中…" : "確認並建立 Agent"}
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={pending}
          className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700 disabled:opacity-50"
        >
          <IconTrash className="h-3.5 w-3.5" />
          忽略
        </button>
      </div>
    </div>
  );
}
