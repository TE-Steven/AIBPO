import mammoth from "mammoth";
import ExcelJS from "exceljs";

// 來源上傳的 Word（.docx）與 Excel（.xlsx）轉成「文字＋圖片」交給 Claude（Claude 只能直接讀 PDF、純文字與圖片）：
// - Word 保留標題、清單、表格結構（HTML），圖片在原本的位置標成「[圖片 N]」，圖片本身另外附上
// - Excel 每個工作表轉成一個 markdown 表格，工作表裡的圖片標在表格後面並另外附上

// 純文字檔太大時，Claude 一次讀不完，也會讓之後每次分析都很貴
const MAX_CHARS = 1_500_000;
// Claude 一次請求最多讀 100 張圖，留一點餘裕給其他檔案
export const MAX_IMAGES_PER_SOURCE = 80;
// 單張圖片上限（Claude 讀圖的限制）；太小的多半是裝飾圖示，略過
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_IMAGE_BYTES = 1500;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type OfficeKind = "docx" | "xlsx";
export type ExtractedImage = { label: string; buffer: Buffer; contentType: string };
export type OfficeContent = { text: string; images: ExtractedImage[] };

export function officeKindOf(file: { name: string; type: string }): OfficeKind | "pdf" | "legacy" | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (name.endsWith(".doc") || name.endsWith(".xls")) return "legacy";
  return null;
}

// 收集圖片：回傳要放在文字裡的標記（附上的圖片「[圖片 N]」，不能附上的寫原因，裝飾小圖不標）
function imageCollector(imageBudget: number) {
  const images: ExtractedImage[] = [];
  return {
    images,
    add(buffer: Buffer, contentType: string): string {
      const type = contentType === "image/jpg" ? "image/jpeg" : contentType;
      if (buffer.length < MIN_IMAGE_BYTES) return "";
      if (!SUPPORTED_IMAGE_TYPES.has(type)) return `[圖片（${contentType.replace("image/", "") || "未知"} 格式 AI 看不到，建議改成 PNG／JPG 或轉 PDF 上傳）]`;
      if (buffer.length > MAX_IMAGE_BYTES) return "[圖片（超過 5MB，AI 看不到）]";
      if (images.length >= imageBudget) return `[圖片（超過 ${MAX_IMAGES_PER_SOURCE} 張上限，沒有附上）]`;
      const label = `[圖片 ${images.length + 1}]`;
      images.push({ label, buffer, contentType: type });
      return label;
    },
  };
}

async function docxToContent(buffer: Buffer, imageBudget: number): Promise<OfficeContent> {
  const collector = imageCollector(imageBudget);
  const markers: string[] = [];
  const { value } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        markers.push(collector.add(await image.readAsBuffer(), image.contentType));
        return { src: `AIBPO_IMG_${markers.length - 1}` };
      }),
    },
  );
  const text = value
    .replace(/<img[^>]*src="AIBPO_IMG_(\d+)"[^>]*\/?>/g, (_, i: string) => markers[Number(i)] ?? "")
    .replace(/<\/(p|h[1-6]|li|tr|table|ul|ol)>/g, "$&\n")
    .trim();
  return { text, images: collector.images };
}

function cellText(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

async function xlsxToContent(buffer: Buffer, imageBudget: number): Promise<OfficeContent> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const collector = imageCollector(imageBudget);
  const sections: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= sheet.actualColumnCount; c++) cells.push(cellText(row.getCell(c).text ?? ""));
      if (cells.some(Boolean)) rows.push(cells);
    });
    const lines: string[] = [];
    if (rows.length > 0) {
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
      const [header, ...body] = rows.map(pad);
      lines.push(`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`));
    }
    for (const img of sheet.getImages()) {
      const media = workbook.getImage(Number(img.imageId));
      if (!media?.buffer) continue;
      const marker = collector.add(Buffer.from(media.buffer as ArrayBuffer), `image/${media.extension}`);
      if (marker) lines.push(`${marker}（位於第 ${Math.floor(img.range.tl.nativeRow) + 1} 列附近）`);
    }
    if (lines.length > 0) sections.push([`## 工作表：${sheet.name}`, "", ...lines].join("\n"));
  });
  return { text: sections.join("\n\n"), images: collector.images };
}

// 回傳要交給 Claude 的文字（開頭註明原始檔名與格式）與圖片；imageBudget＝這個來源還能附上的圖片張數
export async function officeToContent(kind: OfficeKind, buffer: Buffer, fileName: string, imageBudget = MAX_IMAGES_PER_SOURCE): Promise<OfficeContent> {
  const { text, images } = kind === "docx" ? await docxToContent(buffer, imageBudget) : await xlsxToContent(buffer, imageBudget);
  if (!text.trim() && images.length === 0) throw new Error(`「${fileName}」裡沒有讀到任何內容。`);
  if (text.length > MAX_CHARS) throw new Error(`「${fileName}」內容太大（約 ${Math.round(text.length / 10000)} 萬字），請拆成幾個較小的檔案。`);
  const label =
    kind === "docx"
      ? "Word 文件（已轉成 HTML，保留標題、清單與表格結構；[圖片 N] 是原本圖片的位置，圖片另外附上）"
      : "Excel 試算表（每個工作表轉成一個表格，第一列為欄位名稱；[圖片 N] 的圖片另外附上）";
  return { text: `【原始檔案：${fileName}】${label}\n\n${text}`, images };
}
