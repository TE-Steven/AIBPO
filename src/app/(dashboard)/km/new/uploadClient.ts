// 來源檔案上傳的前端共用工具：新增來源、分析頁的「題目來源」都用這裡（一個檔案一個請求上傳到 /api/km/source-files）。
import { formatBytes, maxBytesFor, type FileStats, type SourceFileKind } from "@/lib/sourceLimits";
import type { SignedUpload } from "@/lib/sourceUpload";

export const SOURCE_FILE_ACCEPT =
  "application/pdf,.pdf,.docx,.xlsx,.txt,.csv,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function sourceKindOf(file: File): SourceFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".txt") || name.endsWith(".csv") || file.type === "text/plain" || file.type === "text/csv") return "text";
  return null;
}

// 上傳前就能檢查的問題：格式、單檔大小
export function precheckSourceFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc") || name.endsWith(".xls")) return "舊版 .doc／.xls 不支援，請另存成 .docx／.xlsx";
  const kind = sourceKindOf(file);
  if (!kind) return "只支援 PDF、Word（.docx）、Excel（.xlsx）、文字檔（.txt／.csv）";
  if (file.size > maxBytesFor(kind)) return `超過單檔上限 ${formatBytes(maxBytesFor(kind))}，請拆成較小的檔案`;
  return null;
}

// purpose：questions＝題目來源（只取文字，內容很多時伺服器會先由 AI 萃取出問題清單）
export async function uploadSourceFile(
  file: File,
  imagesUsed: number,
  purpose: "knowledge" | "questions" = "knowledge",
): Promise<{ upload: SignedUpload; stats: FileStats }> {
  const form = new FormData();
  form.append("file", file);
  form.append("imagesUsed", String(imagesUsed));
  form.append("purpose", purpose);
  const res = await fetch("/api/km/source-files", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { error?: string; payload?: string; signature?: string; stats?: FileStats };
  if (!res.ok || !data.payload || !data.signature || !data.stats) throw new Error(data.error ?? `上傳失敗（HTTP ${res.status}）`);
  return { upload: { payload: data.payload, signature: data.signature }, stats: data.stats };
}

export function fileStatsText(s: FileStats): string {
  if (s.kind === "pdf") return `${s.pages} 頁`;
  return `約 ${Math.max(1, Math.round(s.chars / 1000))} 千字${s.images > 0 ? `、${s.images} 張圖` : ""}`;
}
