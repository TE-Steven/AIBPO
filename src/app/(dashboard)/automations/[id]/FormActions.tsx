"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAutomationFormAction, reanalyzeAutomationFormAction, type AutomationActionResult } from "../actions";

// 表單頁右上角：重新分析、刪除
export function FormActions({ id, analyzing }: { id: string; analyzing: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<AutomationActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {result && <span className={`text-xs ${result.error ? "text-rose-600" : "text-emerald-600"}`}>{result.error ?? result.success}</span>}
      <button
        type="button"
        disabled={pending || analyzing}
        onClick={() => {
          if (!confirm("重新分析會用最新的頁面重新整理欄位清單，原本的修改會被覆蓋。確定嗎？")) return;
          startTransition(async () => {
            setResult(await reanalyzeAutomationFormAction(id));
            router.refresh();
          });
        }}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-50 disabled:opacity-50"
      >
        重新分析
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("刪除這張表單？分析結果與紀錄都會一起刪除。")) return;
          startTransition(async () => {
            const r = await deleteAutomationFormAction(id);
            if (r?.error) setResult(r);
          });
        }}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 disabled:opacity-50"
      >
        刪除
      </button>
    </div>
  );
}
