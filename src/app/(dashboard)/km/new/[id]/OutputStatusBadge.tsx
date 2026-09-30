// RAG 內容／Workflow／結構化文件三張產出卡片共用的狀態標籤
const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  NONE: { label: "尚未產生", className: "bg-slate-100 text-slate-500" },
  PENDING: { label: "等待中", className: "bg-amber-50 text-amber-600" },
  PROCESSING: { label: "產生中…", className: "bg-amber-50 text-amber-600" },
  DONE: { label: "已完成", className: "bg-emerald-50 text-emerald-600" },
  FAILED: { label: "失敗", className: "bg-rose-50 text-rose-600" },
};

export function OutputStatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.NONE;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}
