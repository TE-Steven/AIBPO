// 來源檔案的大小限制與「AI 一次讀不讀得完」的估算（前後端共用，純函式）。
// 分析時 Claude 要一次讀完整個來源的所有檔案，所以除了單檔大小，還要看加總的頁數、圖片數與估計 token 數。

export const MAX_PDF_BYTES = 32 * 1024 * 1024; // Claude 讀 PDF 的上限
export const MAX_OFFICE_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_BYTES = 20 * 1024 * 1024; // .txt／.csv
export const MAX_PDF_PAGES = 600; // Claude 一次請求讀 PDF 的頁數上限
export const MAX_IMAGES = 100; // Claude 一次請求讀圖的上限
// 模型上下文 100 萬 token，扣掉提示詞、思考與輸出，留給來源內容約 80 萬
export const TOKEN_BUDGET = 800_000;
const WARN_RATIO = 0.7;

// 粗估：PDF 每頁連同頁面圖片約 2,500 token；Word／Excel 轉成的文字每字約 1 token；每張圖片約 1,600 token
const TOKENS_PER_PDF_PAGE = 2_500;
const TOKENS_PER_IMAGE = 1_600;

export type SourceFileKind = "pdf" | "docx" | "xlsx" | "text";
export type FileStats = { fileName: string; kind: SourceFileKind; bytes: number; pages: number; chars: number; images: number; estTokens: number };

export function estimateTokens(stats: Pick<FileStats, "kind" | "pages" | "chars" | "images">): number {
  return stats.kind === "pdf" ? stats.pages * TOKENS_PER_PDF_PAGE : stats.chars + stats.images * TOKENS_PER_IMAGE;
}

export function maxBytesFor(kind: SourceFileKind): number {
  return kind === "pdf" ? MAX_PDF_BYTES : kind === "text" ? MAX_TEXT_BYTES : MAX_OFFICE_BYTES;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type TotalsCheck = {
  level: "ok" | "warn" | "over";
  pages: number;
  images: number;
  estTokens: number;
  percent: number; // 佔 AI 一次可讀上限的比例（取頁數、圖片、token 三者最高）
  message: string | null;
};

// 整個來源的加總檢查：超過就不能建立（分析一定會失敗），接近上限先提醒
export function checkTotals(files: FileStats[]): TotalsCheck {
  const pages = files.reduce((n, f) => n + f.pages, 0);
  const images = files.reduce((n, f) => n + f.images, 0);
  const estTokens = files.reduce((n, f) => n + f.estTokens, 0);
  const ratio = Math.max(pages / MAX_PDF_PAGES, images / MAX_IMAGES, estTokens / TOKEN_BUDGET);
  const percent = Math.round(ratio * 100);
  if (ratio > 1) {
    const parts = Math.ceil(ratio);
    return {
      level: "over",
      pages,
      images,
      estTokens,
      percent,
      message: `內容太多，AI 一次讀不完（約上限的 ${percent}%）：PDF 共 ${pages} 頁、圖片 ${images} 張、估計約 ${Math.round(estTokens / 10000)} 萬 token。請拆成至少 ${parts} 個來源分別建立。`,
    };
  }
  if (ratio >= WARN_RATIO) {
    return {
      level: "warn",
      pages,
      images,
      estTokens,
      percent,
      message: `內容接近 AI 一次能讀的上限（約 ${percent}%）。可以建立，但分析會比較久、比較貴；之後再加內容可能就會超過。`,
    };
  }
  return { level: "ok", pages, images, estTokens, percent, message: null };
}
