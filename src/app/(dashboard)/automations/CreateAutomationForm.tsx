"use client";

import { useState, useTransition } from "react";
import { createAutomationFormAction, type AutomationActionResult } from "./actions";
import { IconPlus } from "@/components/icons";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

// 登記一張新表單：名稱、網址、確認有授權
export function CreateAutomationForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [result, setResult] = useState<AutomationActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm"
      >
        <IconPlus className="h-4 w-4" />
        新增表單
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">新增表單</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">名稱</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：TCL 維修申請單" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">表單網址</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inputClass} />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-slate-600">
        <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5" />
        <span>
          我確認這是<b>公司自己的表單</b>，或已取得<b>表單擁有者授權</b>可以用程式自動填寫送出。需要登入、驗證碼（CAPTCHA）、簡訊驗證或付款的表單不支援。
        </span>
      </label>
      {result?.error && <p className="mt-2 text-xs text-rose-600">{result.error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          取消
        </button>
        <button
          type="button"
          disabled={pending || !name.trim() || !url.trim() || !authorized}
          onClick={() =>
            startTransition(async () => {
              // 成功會直接轉到表單頁；失敗才會回傳錯誤
              const r = await createAutomationFormAction({ name, url, authorized });
              if (r?.error) setResult(r);
            })
          }
          className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
        >
          {pending ? "登記中…" : "登記並開始分析"}
        </button>
      </div>
    </div>
  );
}
