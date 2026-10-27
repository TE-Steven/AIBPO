import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AUTOMATION_STATUS, cleanFields, cleanPageInfo } from "@/lib/automationFields";
import { LocalTime } from "@/components/LocalTime";
import { IconAlertTriangle, IconArrowLeft } from "@/components/icons";
import { FieldsEditor } from "./FieldsEditor";
import { FormActions } from "./FormActions";
import { AutoRefresh } from "./AutoRefresh";
import { AutomationGuide } from "../AutomationGuide";

export const dynamic = "force-dynamic";

// 排隊超過 2 分鐘還沒開始：Worker 可能還沒啟動
function queuedTooLong(job: { status: string; createdAt: Date } | null) {
  return job?.status === "PENDING" && Date.now() - job.createdAt.getTime() > 2 * 60_000;
}

export default async function AutomationFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireCompanyUser();
  const form = await prisma.automationForm.findUnique({ where: { id } });
  if (!form || form.roleId !== session.roleId) notFound();
  const pendingJob = await prisma.automationJob.findFirst({
    where: { formId: id, type: "ANALYZE", status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  const status = AUTOMATION_STATUS[form.status] ?? AUTOMATION_STATUS.DRAFT;
  const fields = cleanFields(form.fields);
  const info = form.pageInfo ? cleanPageInfo(form.pageInfo) : null;
  const workerSlow = queuedTooLong(pendingJob);

  return (
    <div className="animate-fade-in space-y-6">
      {pendingJob && <AutoRefresh />}
      <div>
        <Link href="/automations" className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <IconArrowLeft className="h-4 w-4" />
          回到自動化管理
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{form.name}</h1>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${status.className}`}>{status.label}</span>
          <AutomationGuide />
          <div className="ml-auto">
            <FormActions id={form.id} analyzing={Boolean(pendingJob)} />
          </div>
        </div>
        <p className="mt-1 break-all text-xs text-slate-500">
          <a href={form.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">
            {form.url}
          </a>
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {form.authorizedBy} 於 <LocalTime iso={form.authorizedAt.toISOString()} /> 確認已取得授權
          {form.analyzedAt && (
            <>
              ・最近分析 <LocalTime iso={form.analyzedAt.toISOString()} />
            </>
          )}
        </p>
      </div>

      {pendingJob && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <span className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-[3px] border-sky-200 border-t-sky-600" />
          <div>
            <p className="font-semibold">{pendingJob.status === "RUNNING" ? "分析中：瀏覽器打開表單、AI 整理欄位…" : "排隊中，等背景 Worker 開始分析…"}</p>
            <p className="mt-0.5 text-xs text-sky-800">通常 30 秒到 2 分鐘完成，畫面會自動更新。</p>
            {workerSlow && (
              <p className="mt-1 text-xs font-medium text-amber-800">已經排隊超過 2 分鐘：背景 Worker 可能還沒啟動，請確認 Render 上的 Worker 服務是 Live 狀態。</p>
            )}
          </div>
        </div>
      )}

      {form.status === "BLOCKED" && info && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-inset ring-rose-100">
          <p className="flex items-center gap-1.5 font-semibold">
            <IconAlertTriangle className="h-4 w-4" />
            這張表單不支援自動填寫
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {info.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {form.status === "FAILED" && form.errorMessage && (
        <p className="flex items-start gap-2 rounded-xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-inset ring-rose-100">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          分析失敗：{form.errorMessage}
        </p>
      )}

      {info && form.status !== "BLOCKED" && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">{info.title || "表單"}</h2>
            {info.description && <p className="mt-1 text-xs text-slate-500">{info.description}</p>}
            <p className="mt-2 text-xs text-slate-500">送出按鈕：{info.submitText ?? "（沒有找到）"}</p>
            {info.notes && (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-100">
                <span className="font-semibold">AI 備註：</span>
                {info.notes}
              </div>
            )}
          </div>
          {form.screenshot && (
            <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">分析時的頁面截圖</summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/jpeg;base64,${form.screenshot}`} alt="表單截圖" className="mt-3 w-full rounded-lg border border-slate-200" />
            </details>
          )}
        </div>
      )}

      {fields.length > 0 && <FieldsEditor id={form.id} initialFields={fields} />}

      {(form.status === "READY" || form.status === "ACTIVE") && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
          <p className="font-semibold text-slate-700">下一步：產生 API</p>
          <p className="mt-1 text-xs">確認欄位清單後，就能產生這張表單的 API 與文件、讓機器人呼叫時自動代為填寫送出。這部分在下一階段開放。</p>
        </div>
      )}
    </div>
  );
}
