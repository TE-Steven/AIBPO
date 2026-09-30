"use client";

import { useActionState, useState, useTransition } from "react";
import { createTallyAction, deleteTallyAction, updateTallyAction, type TallyActionState } from "./actions";
import { IconCheckCircle, IconAlertTriangle, IconPlus, IconTrash, IconPencil } from "@/components/icons";

const DESCRIPTION_HINT = "選填。說明這個分類包含什麼、不包含什麼，AI 會依此判斷。例：「建議售價，含稅，不含安裝費」";

const initialState: TallyActionState = {};

export function CreateTallyForm({ parentOptions }: { parentOptions: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(createTallyAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">分類名稱</label>
          <input
            name="name"
            type="text"
            required
            placeholder="例如：商品資訊"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">上層分類（選填）</label>
          <select
            name="parentId"
            defaultValue=""
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
          >
            <option value="">無（建立大分類）</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">描述（選填）</label>
          <textarea
            name="description"
            rows={2}
            maxLength={1000}
            placeholder="例：指 Waferlock 電子鎖主機型號，不含電池與配件"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
          />
          <p className="mt-1 text-xs text-slate-400">{DESCRIPTION_HINT}</p>
        </div>
      </div>
      {(state.success || state.error) && (
        <p
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
            state.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
          }`}
        >
          {state.error ? <IconAlertTriangle className="h-4 w-4 shrink-0" /> : <IconCheckCircle className="h-4 w-4 shrink-0" />}
          {state.error ?? state.success}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
      >
        <IconPlus className="h-4 w-4" />
        {pending ? "建立中…" : "新增分類"}
      </button>
    </form>
  );
}

// 每一層都可以刪：先顯示影響範圍（會一併刪掉幾個子分類、幾筆 KM 會變未分類），按確定才刪
export function DeleteTallyButton({
  tallyId,
  name,
  descendantCount,
  entryCount,
}: {
  tallyId: string;
  name: string;
  descendantCount: number;
  entryCount: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<TallyActionState>({});
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteTallyAction(tallyId);
      setMessage(result);
      setConfirming(false);
    });
  }

  if (message.error) {
    return <span className="text-xs text-rose-600">{message.error}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700"
      >
        <IconTrash className="h-3.5 w-3.5" />
        刪除
      </button>
    );
  }

  const impacts = [
    descendantCount > 0 ? `底下 ${descendantCount} 個子分類會一併刪除` : null,
    entryCount > 0 ? `${entryCount} 筆 KM 會改為未分類（題目本身不會刪除）` : null,
  ].filter(Boolean);

  return (
    <div className="max-w-xs space-y-1.5 rounded-lg bg-rose-50 p-2.5 text-xs ring-1 ring-inset ring-rose-100">
      <p className="font-medium text-rose-700">確定刪除「{name}」？</p>
      {impacts.length > 0 && (
        <ul className="list-disc pl-4 text-rose-600">
          {impacts.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3 pt-0.5">
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-md bg-rose-600 px-2.5 py-1 font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? "刪除中…" : "確定刪除"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="font-medium text-slate-500 hover:text-slate-700">
          取消
        </button>
      </div>
    </div>
  );
}

// 分類名稱＋描述：平常顯示，按「編輯」就地修改
export function TallyNameCell({ tallyId, name, description }: { tallyId: string; name: string; description: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateTallyAction(tallyId, { name: draftName, description: draftDescription });
      if (result.error) setError(result.error);
      else setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-800">{name}</span>
          <button
            type="button"
            onClick={() => {
              setDraftName(name);
              setDraftDescription(description ?? "");
              setEditing(true);
            }}
            aria-label={`編輯「${name}」`}
            className="text-slate-300 transition hover:text-teal-600"
          >
            <IconPencil className="h-3.5 w-3.5" />
          </button>
        </div>
        {description ? (
          <p className="mt-0.5 whitespace-pre-wrap text-xs font-normal text-slate-500">{description}</p>
        ) : (
          <p className="mt-0.5 text-xs font-normal text-slate-300">尚未填寫描述</p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-2">
      <input
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        aria-label="分類名稱"
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
      />
      <textarea
        value={draftDescription}
        onChange={(e) => setDraftDescription(e.target.value)}
        rows={2}
        maxLength={1000}
        aria-label="分類描述"
        placeholder="描述（選填）"
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-normal shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
      />
      <p className="text-xs font-normal text-slate-400">{DESCRIPTION_HINT}</p>
      {error && <p className="text-xs font-normal text-rose-600">{error}</p>}
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-teal-600 px-3 py-1.5 font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
        >
          {pending ? "儲存中…" : "儲存"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="font-medium text-slate-500 hover:text-slate-700">
          取消
        </button>
      </div>
    </div>
  );
}
