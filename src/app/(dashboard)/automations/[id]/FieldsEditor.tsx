"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAutomationFieldsAction, type AutomationActionResult } from "../actions";
import { FIELD_TYPES, FIELD_TYPE_LABELS, type AutomationField, type AutomationFieldType } from "@/lib/automationFields";
import { InfoTip } from "../../optimize/optimizeShared";

// 欄位清單：AI 整理的結果，管理員可以修改 API 參數名稱、類型、必填、不讓 API 填、預設值、說明
const cell = "rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100";

const TIPS = {
  key: "API 參數名稱：呼叫 API 時用這個名稱帶值（小寫英文、數字、底線；重複時儲存會自動加編號）。",
  type: "欄位類型：決定 API 檢查格式的方式，以及之後瀏覽器怎麼填寫（例如下拉要選選項、檔案要上傳）。",
  required: "必填：呼叫 API 時沒帶這個欄位，會直接回錯誤、不送出表單。",
  hidden: "不讓 API 填：這個欄位不會出現在 API 裡（例如內部欄位、已經由系統指定的欄位）；有預設值的話一律填預設值。",
  defaultValue: "預設值：API 沒帶這個欄位時自動填這個值。下拉、單選要填選項的值。",
  options: "選項數：下拉、單選、多選、階層下拉可以選的值。呼叫 API 時只能帶清單裡的值。",
};

export function FieldsEditor({ id, initialFields }: { id: string; initialFields: AutomationField[] }) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  const [result, setResult] = useState<AutomationActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(fields) !== JSON.stringify(initialFields);

  function update(i: number, patch: Partial<AutomationField>) {
    setResult(null);
    setFields((cur) => cur.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">欄位清單</h2>
        <span className="text-xs text-slate-500">
          共 {fields.length} 個，必填 {fields.filter((f) => f.required).length} 個
        </span>
        <div className="ml-auto flex items-center gap-2">
          {result && <span className={`text-xs ${result.error ? "text-rose-600" : "text-emerald-600"}`}>{result.error ?? result.success}</span>}
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={() => setFields(initialFields)}
            className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            還原
          </button>
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={() =>
              startTransition(async () => {
                setResult(await saveAutomationFieldsAction(id, fields));
                router.refresh();
              })
            }
            className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {pending ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-xs">
          <thead>
            <tr className="text-left text-[11px] text-slate-400">
              <th className="px-4 py-2 font-medium">欄位</th>
              <th className="py-2 font-medium">
                <span className="inline-flex items-center">API 參數<InfoTip>{TIPS.key}</InfoTip></span>
              </th>
              <th className="py-2 font-medium">
                <span className="inline-flex items-center">類型<InfoTip>{TIPS.type}</InfoTip></span>
              </th>
              <th className="py-2 text-center font-medium">
                <span className="inline-flex items-center">必填<InfoTip>{TIPS.required}</InfoTip></span>
              </th>
              <th className="py-2 text-center font-medium">
                <span className="inline-flex items-center">不讓 API 填<InfoTip>{TIPS.hidden}</InfoTip></span>
              </th>
              <th className="py-2 font-medium">
                <span className="inline-flex items-center">預設值<InfoTip>{TIPS.defaultValue}</InfoTip></span>
              </th>
              <th className="py-2 pr-4 text-right font-medium">
                <span className="inline-flex items-center">選項<InfoTip>{TIPS.options}</InfoTip></span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fields.map((f, i) => (
              <tr key={i} className={f.hidden ? "bg-slate-50/70 text-slate-400" : ""}>
                <td className="px-4 py-2 align-top">
                  <p className="font-medium text-slate-800">{f.label}</p>
                  <input
                    value={f.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="說明（呼叫的人看得到）"
                    className={`${cell} mt-1 w-64`}
                  />
                </td>
                <td className="py-2 align-top">
                  <input value={f.key} onChange={(e) => update(i, { key: e.target.value })} className={`${cell} w-40 font-mono`} />
                </td>
                <td className="py-2 align-top">
                  <select value={f.type} onChange={(e) => update(i, { type: e.target.value as AutomationFieldType })} className={cell}>
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {FIELD_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-center align-top">
                  <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} aria-label={`${f.label} 必填`} />
                </td>
                <td className="py-2 text-center align-top">
                  <input type="checkbox" checked={f.hidden} onChange={(e) => update(i, { hidden: e.target.checked })} aria-label={`${f.label} 不讓 API 填`} />
                </td>
                <td className="py-2 align-top">
                  <input
                    value={f.defaultValue ?? ""}
                    onChange={(e) => update(i, { defaultValue: e.target.value || null })}
                    className={`${cell} w-32`}
                  />
                </td>
                <td className="py-2 pr-4 text-right align-top">
                  {f.options.length > 0 ? (
                    <button type="button" onClick={() => setOpenOptions(openOptions === f.key ? null : f.key)} className="text-teal-700 hover:underline">
                      {f.options.length} 個{openOptions === f.key ? "（收起）" : ""}
                    </button>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                  {openOptions === f.key && (
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-md bg-slate-50 p-2 text-left text-[11px] text-slate-600">
                      {f.levels.length > 0 && <p className="mb-1 text-slate-400">階層：{f.levels.join(" > ")}</p>}
                      {f.options.map((o, k) => (
                        <p key={k}>
                          {o.parent ? <span className="text-slate-400">{o.parent} &gt; </span> : null}
                          {o.label}
                          {o.value !== o.label && <span className="ml-1 font-mono text-slate-400">（{o.value}）</span>}
                        </p>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
