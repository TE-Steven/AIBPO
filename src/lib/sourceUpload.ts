import { createHmac, timingSafeEqual } from "node:crypto";
import { toFile } from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { anthropic } from "@/lib/anthropic";
import { MAX_IMAGES_PER_SOURCE, officeKindOf, officeToContent } from "@/lib/officeToText";
import { estimateTokens, formatBytes, maxBytesFor, type FileStats } from "@/lib/sourceLimits";
import type { SourceFileRef } from "@/lib/kmAnalysis";

// 來源檔案一個一個上傳：轉換（Word／Excel 轉文字＋圖片）→ 上傳到 Claude Files API → 回傳檔案參照與分量統計。
// 回傳內容用 HMAC 簽章：建立來源時只接受簽章正確、而且是同一個使用者上傳的檔案，避免有人塞入別人的檔案 id。

export type UploadedFile = { refs: SourceFileRef[]; stats: FileStats };
export type SignedUpload = { payload: string; signature: string };

export class UploadError extends Error {}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function signUpload(userId: string, uploaded: UploadedFile): SignedUpload {
  const payload = JSON.stringify({ userId, ...uploaded });
  return { payload, signature: sign(payload) };
}

export function verifyUpload(userId: string, signed: SignedUpload): UploadedFile | null {
  const expected = Buffer.from(sign(signed.payload), "hex");
  const actual = Buffer.from(signed.signature ?? "", "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const parsed = JSON.parse(signed.payload) as { userId: string } & UploadedFile;
  return parsed.userId === userId ? { refs: parsed.refs, stats: parsed.stats } : null;
}

// PDF 頁數：完整解析大 PDF 很吃記憶體（伺服器會被撐爆），所以先直接數檔案裡的頁面標記；
// 數不到（頁面資料被壓縮）時，10MB 以下才完整解析，更大的依檔案大小估算
const PDF_FULL_PARSE_LIMIT = 10 * 1024 * 1024;
const PDF_BYTES_PER_PAGE_ESTIMATE = 100 * 1024;

async function countPdfPages(buffer: Buffer, fileName: string): Promise<number> {
  const marked = (buffer.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  if (marked > 0) return marked;
  if (buffer.length > PDF_FULL_PARSE_LIMIT) return Math.max(1, Math.round(buffer.length / PDF_BYTES_PER_PAGE_ESTIMATE));
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    throw new UploadError(`「${fileName}」無法讀取，可能有密碼保護或檔案損毀。`);
  }
}

// imagesUsed：這個來源前面的檔案已經附上的圖片張數（每個來源最多 80 張）
export async function processSourceFile(file: File, imagesUsed: number): Promise<UploadedFile> {
  const kind = officeKindOf(file);
  if (kind === "legacy") throw new UploadError(`「${file.name}」是舊版 .doc／.xls，請在 Word／Excel 另存成 .docx／.xlsx 再上傳。`);
  if (kind === null) throw new UploadError(`「${file.name}」不是 PDF、Word（.docx）、Excel（.xlsx）或文字檔（.txt／.csv）。`);
  if (file.size > maxBytesFor(kind)) {
    throw new UploadError(`「${file.name}」有 ${formatBytes(file.size)}，超過單檔上限 ${formatBytes(maxBytesFor(kind))}，請拆成較小的檔案。`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (kind === "pdf") {
    const pages = await countPdfPages(buffer, file.name);
    const uploaded = await anthropic.files.upload({ file: await toFile(buffer, file.name, { type: "application/pdf" }) });
    const base = { kind, pages, chars: 0, images: 0 } as const;
    return {
      refs: [{ fileId: uploaded.id, fileName: file.name, kind: "document" }],
      stats: { fileName: file.name, bytes: file.size, ...base, estTokens: estimateTokens(base) },
    };
  }

  if (kind === "text") {
    // .txt／.csv：Windows 存的中文檔常是 Big5，先試 UTF-8、失敗再用 Big5 讀，統一轉成 UTF-8 上傳
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder("big5").decode(buffer);
    }
    text = text.replace(/^\uFEFF/, "");
    if (!text.trim()) throw new UploadError(`「${file.name}」是空的。`);
    const uploaded = await anthropic.files.upload({
      file: await toFile(Buffer.from(`【原始檔案：${file.name}】\n\n${text}`, "utf8"), `${file.name}.txt`, { type: "text/plain" }),
    });
    const base = { kind, pages: 0, chars: text.length, images: 0 } as const;
    return {
      refs: [{ fileId: uploaded.id, fileName: file.name, kind: "document" }],
      stats: { fileName: file.name, bytes: file.size, ...base, estTokens: estimateTokens(base) },
    };
  }

  // Word／Excel：文字以純文字檔上傳；裡面的圖片一張張以圖片上傳，文字裡的「[圖片 N]」標出原本的位置
  const content = await officeToContent(kind, buffer, file.name, Math.max(0, MAX_IMAGES_PER_SOURCE - imagesUsed));
  const refs: SourceFileRef[] = [];
  const textFile = await anthropic.files.upload({
    file: await toFile(Buffer.from(content.text, "utf8"), `${file.name}.txt`, { type: "text/plain" }),
  });
  refs.push({ fileId: textFile.id, fileName: file.name, kind: "document" });
  // 圖片同時傳 4 張（一張張傳，圖片多的文件要等很久）；結果依原本順序排回去
  const imageRefs: SourceFileRef[] = new Array(content.images.length);
  let next = 0;
  async function worker() {
    while (next < content.images.length) {
      const n = next++;
      const image = content.images[n];
      const ext = image.contentType.replace("image/", "");
      const imageFile = await anthropic.files.upload({
        file: await toFile(image.buffer, `${file.name}-圖${n + 1}.${ext}`, { type: image.contentType }),
      });
      imageRefs[n] = { fileId: imageFile.id, fileName: file.name, kind: "image", label: image.label };
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(4, content.images.length) }, worker));
  } catch (err) {
    // 有一張失敗就整個檔案算失敗：已經傳上去的刪掉，避免留下沒用的檔案
    await deleteUploadedFiles([...refs, ...imageRefs.filter(Boolean)]);
    throw err;
  }
  refs.push(...imageRefs);
  const base = { kind, pages: 0, chars: content.text.length, images: content.images.length } as const;
  return { refs, stats: { fileName: file.name, bytes: file.size, ...base, estTokens: estimateTokens(base) } };
}

// 沒有用上的檔案（例如加總超過上限、使用者取消）從 Claude 刪掉
export async function deleteUploadedFiles(refs: SourceFileRef[]): Promise<void> {
  await Promise.all(refs.map((r) => anthropic.files.delete(r.fileId).catch(() => {})));
}
