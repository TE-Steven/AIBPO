"use client";

import { useActionState, useState } from "react";
import { createSkillAction, type SkillActionState, type SkillHeader, type SkillParam } from "./actions";
import { IconCheckCircle, IconAlertTriangle, IconPlus, IconTrash } from "@/components/icons";

const initialState: SkillActionState = {};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-700";

export type SkillInitialValues = {
  name: string;
  description: string;
  method: string;
  urlTemplate: string;
  authType: string;
  authConfig: unknown;
  headers: SkillHeader[];
  bodyTemplate: string;
  paramsSchema: SkillParam[];
};

function authConfigField(authConfig: unknown, field: string): string {
  if (!authConfig || typeof authConfig !== "object") return "";
  const value = (authConfig as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

export function SkillForm({
  action = createSkillAction,
  initialValues,
  submitLabel = "新增 Skill",
  pendingLabel = "建立中…",
}: {
  action?: (prevState: SkillActionState, formData: FormData) => Promise<SkillActionState>;
  initialValues?: SkillInitialValues;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [method, setMethod] = useState(initialValues?.method ?? "GET");
  const [authType, setAuthType] = useState(initialValues?.authType ?? "NONE");
  const [headers, setHeaders] = useState<SkillHeader[]>(initialValues?.headers ?? []);
  const [params, setParams] = useState<SkillParam[]>(initialValues?.paramsSchema ?? []);

  const hasBody = ["POST", "PUT", "PATCH"].includes(method);

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>名稱</label>
          <input name="name" type="text" required defaultValue={initialValues?.name} placeholder="例如：查詢維修單狀態" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>HTTP 方法</label>
          <select
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className={inputClass}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>說明（AI 會靠這段判斷何時該用這個 Skill）</label>
        <textarea
          name="description"
          required
          rows={2}
          defaultValue={initialValues?.description}
          placeholder="例如：輸入維修單號，查詢目前的維修進度"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>URL（可用 {"{{param}}"} 佔位符，對應下方參數名稱）</label>
        <input
          name="urlTemplate"
          type="text"
          required
          defaultValue={initialValues?.urlTemplate}
          placeholder="https://api.example.com/repairs/{{ticketId}}"
          className={inputClass}
        />
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <label className={labelClass}>認證方式</label>
        <select
          name="authType"
          value={authType}
          onChange={(e) => setAuthType(e.target.value)}
          className={`${inputClass} sm:w-64`}
        >
          <option value="NONE">無</option>
          <option value="BEARER">Bearer Token</option>
          <option value="API_KEY_HEADER">API Key（自訂 Header）</option>
          <option value="BASIC">Basic Auth</option>
        </select>

        {authType === "BEARER" && (
          <div className="mt-3">
            <label className={labelClass}>Token</label>
            <input name="authToken" type="text" defaultValue={authConfigField(initialValues?.authConfig, "token")} className={inputClass} />
          </div>
        )}
        {authType === "API_KEY_HEADER" && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Header 名稱</label>
              <input
                name="authHeaderName"
                type="text"
                placeholder="X-Api-Key"
                defaultValue={authConfigField(initialValues?.authConfig, "headerName")}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>值</label>
              <input
                name="authHeaderValue"
                type="text"
                defaultValue={authConfigField(initialValues?.authConfig, "value")}
                className={inputClass}
              />
            </div>
          </div>
        )}
        {authType === "BASIC" && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>帳號</label>
              <input
                name="authUsername"
                type="text"
                defaultValue={authConfigField(initialValues?.authConfig, "username")}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>密碼</label>
              <input
                name="authPassword"
                type="password"
                defaultValue={authConfigField(initialValues?.authConfig, "password")}
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700">Headers（選填，值也可用 {"{{param}}"}）</label>
          <button
            type="button"
            onClick={() => setHeaders((prev) => [...prev, { key: "", value: "" }])}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
          >
            <IconPlus className="h-3.5 w-3.5" />
            新增一列
          </button>
        </div>
        <div className="space-y-2">
          {headers.map((h, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={h.key}
                onChange={(e) => setHeaders((prev) => prev.map((row, idx) => (idx === i ? { ...row, key: e.target.value } : row)))}
                placeholder="Header 名稱"
                className={inputClass}
              />
              <input
                value={h.value}
                onChange={(e) => setHeaders((prev) => prev.map((row, idx) => (idx === i ? { ...row, value: e.target.value } : row)))}
                placeholder="值"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setHeaders((prev) => prev.filter((_, idx) => idx !== i))}
                className="shrink-0 rounded-lg p-2 text-rose-500 hover:bg-rose-50"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </div>
          ))}
          {headers.length === 0 && <p className="text-xs text-slate-400">沒有自訂 Header</p>}
        </div>
        <input type="hidden" name="headersJson" value={JSON.stringify(headers)} readOnly />
      </div>

      {hasBody && (
        <div>
          <label className={labelClass}>
            Body 樣板（JSON，字串值請用雙引號包住佔位符，例如 {"\"{{name}}\""}）
          </label>
          <textarea
            name="bodyTemplate"
            rows={3}
            defaultValue={initialValues?.bodyTemplate}
            placeholder={'{"name": "{{name}}", "amount": {{amount}}}'}
            className={`${inputClass} font-mono text-xs`}
          />
        </div>
      )}

      <div className="rounded-lg border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700">參數（AI 呼叫時需要提供的欄位）</label>
          <button
            type="button"
            onClick={() => setParams((prev) => [...prev, { name: "", type: "string", description: "", required: true }])}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
          >
            <IconPlus className="h-3.5 w-3.5" />
            新增一列
          </button>
        </div>
        <div className="space-y-2">
          {params.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_1fr_5rem_2.5rem] items-center gap-2">
              <input
                value={p.name}
                onChange={(e) => setParams((prev) => prev.map((row, idx) => (idx === i ? { ...row, name: e.target.value } : row)))}
                placeholder="參數名稱"
                className={inputClass}
              />
              <select
                value={p.type}
                onChange={(e) => setParams((prev) => prev.map((row, idx) => (idx === i ? { ...row, type: e.target.value } : row)))}
                className={inputClass}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="array">array</option>
              </select>
              <input
                value={p.description}
                onChange={(e) => setParams((prev) => prev.map((row, idx) => (idx === i ? { ...row, description: e.target.value } : row)))}
                placeholder="說明（給 AI 看）"
                className={inputClass}
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={p.required}
                  onChange={(e) => setParams((prev) => prev.map((row, idx) => (idx === i ? { ...row, required: e.target.checked } : row)))}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
                />
                必填
              </label>
              <button
                type="button"
                onClick={() => setParams((prev) => prev.filter((_, idx) => idx !== i))}
                className="shrink-0 rounded-lg p-2 text-rose-500 hover:bg-rose-50"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </div>
          ))}
          {params.length === 0 && <p className="text-xs text-slate-400">尚未設定任何參數</p>}
        </div>
        <input type="hidden" name="paramsJson" value={JSON.stringify(params)} readOnly />
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
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
