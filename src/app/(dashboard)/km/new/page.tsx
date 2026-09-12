import Link from "next/link";
import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { UploadPdfForm, UploadUrlForm } from "./UploadForms";
import { IconSparkles } from "@/components/icons";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PENDING: { label: "待設定", className: "bg-slate-100 text-slate-500" },
  PROCESSING: { label: "分析中", className: "bg-amber-50 text-amber-600" },
  DONE: { label: "已完成", className: "bg-emerald-50 text-emerald-600" },
  FAILED: { label: "失敗", className: "bg-rose-50 text-rose-600" },
};

export default async function NewKmPage() {
  const session = await requireSession();

  const sources = await prisma.kmSource.findMany({
    where: roleScope(session),
    include: { _count: { select: { entries: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">新增 KM</h1>
        <p className="mt-1 text-sm text-slate-500">上傳 PDF 或貼上網址，AI 會依你指定的維度分析出 FAQ 知識庫。</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">上傳 PDF</h2>
          <UploadPdfForm />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">貼上網址</h2>
          <UploadUrlForm />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">來源紀錄</h2>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">標題</th>
              <th className="px-5 py-3">類型</th>
              <th className="px-5 py-3">狀態</th>
              <th className="px-5 py-3">KM 數量</th>
              <th className="px-5 py-3">建立時間</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sources.map((s) => {
              const status = STATUS_LABEL[s.status] ?? STATUS_LABEL.PENDING;
              return (
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/km/new/${s.id}`} className="flex items-center gap-2.5 font-medium text-slate-800">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                        <IconSparkles className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">{s.title}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{s.sourceType}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                      {status.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{s._count.entries}</td>
                  <td className="px-5 py-3 text-slate-500">{s.createdAt.toLocaleString("zh-TW")}</td>
                </tr>
              );
            })}
            {sources.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">
                  尚未上傳任何來源
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
