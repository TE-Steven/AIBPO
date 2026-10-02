import mammoth from "mammoth";
import ExcelJS from "exceljs";

// 來源上傳的 Word（.docx）與 Excel（.xlsx）轉成文字，再以純文字檔交給 Claude（Claude 只能直接讀 PDF 與純文字）。
// Word 保留標題、清單、表格結構（HTML）；Excel 每個工作表轉成一個 markdown 表格。圖片不保留。

// 純文字檔太大時，Claude 一次讀不完，也會讓之後每次分析都很貴
const MAX_CHARS = 1_500_000;

export type OfficeKind = "docx" | "xlsx";

export function officeKindOf(file: { name: string; type: string }): OfficeKind | "pdf" | "legacy" | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (name.endsWith(".doc") || name.endsWith(".xls")) return "legacy";
  return null;
}

async function docxToText(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer });
  return value
    .replace(/<img[^>]*>/g, "") // 圖片是 base64，會讓檔案暴增，而且 Claude 讀不到內容
    .replace(/<\/(p|h[1-6]|li|tr|table|ul|ol)>/g, "$&\n")
    .trim();
}

function cellText(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

async function xlsxToText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sections: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= sheet.actualColumnCount; c++) cells.push(cellText(row.getCell(c).text ?? ""));
      if (cells.some(Boolean)) rows.push(cells);
    });
    if (rows.length === 0) return;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
    const [header, ...body] = rows.map(pad);
    sections.push(
      [`## 工作表：${sheet.name}`, "", `| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n"),
    );
  });
  return sections.join("\n\n");
}

// 回傳要上傳給 Claude 的純文字內容（開頭註明原始檔名與格式）
export async function officeToText(kind: OfficeKind, buffer: Buffer, fileName: string): Promise<string> {
  const body = kind === "docx" ? await docxToText(buffer) : await xlsxToText(buffer);
  if (!body.trim()) throw new Error(`「${fileName}」裡沒有讀到任何文字內容。`);
  if (body.length > MAX_CHARS) throw new Error(`「${fileName}」內容太大（約 ${Math.round(body.length / 10000)} 萬字），請拆成幾個較小的檔案。`);
  const label = kind === "docx" ? "Word 文件（已轉成 HTML，保留標題、清單與表格結構）" : "Excel 試算表（每個工作表轉成一個表格，第一列為欄位名稱）";
  return `【原始檔案：${fileName}】${label}\n\n${body}`;
}
