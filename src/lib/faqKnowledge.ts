import ExcelJS from "exceljs";

// FAQ優化的 FAQ 清單：每一題＝分類、主問題、相似句、標題、答案。
// 匯入 telligent FAQ 知識庫用的 Excel 照官方範本（FAQ Knowdege Import Template.xlsx）的格式產生：
// - 欄位：Category／Sub-category／Main Question／Similar Sentence／Title／Answer Example 1～3
// - 一列只能放一個相似句：同一題有多個相似句就複製成多列（分類、主問題、標題、答案都一樣）
// - 長度：分類 50、主問題與相似句 300、標題 20、每個答案框 500（答案超過就拆到答案框 2、3）

export type FaqItem = {
  category: string;
  subCategory: string;
  question: string;
  similar: string[];
  title: string;
  answer: string;
};

export const FAQ_LIMITS = { category: 50, question: 300, similar: 300, title: 20, answerBox: 500, answerBoxes: 3 } as const;
export const FAQ_ANSWER_MAX = FAQ_LIMITS.answerBox * FAQ_LIMITS.answerBoxes;
const UNCATEGORIZED = "未分類";

export function cleanFaqItems(input: unknown): FaqItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const r = (raw ?? {}) as Partial<FaqItem>;
      return {
        category: String(r.category ?? "").trim() || UNCATEGORIZED,
        subCategory: String(r.subCategory ?? "").trim() || String(r.category ?? "").trim() || UNCATEGORIZED,
        question: String(r.question ?? "").trim(),
        similar: Array.isArray(r.similar) ? r.similar.map((s) => String(s).trim()).filter(Boolean) : [],
        title: String(r.title ?? "").trim(),
        answer: String(r.answer ?? "").trim(),
      };
    })
    .filter((f) => f.question);
}

// 分類路徑（「大 › 中 › 小」或「大 > 中」）→ 大分類、子分類（三層時中、小合併成子分類）
export function categoryFromTallyPath(path: string | null | undefined): { category: string; subCategory: string } {
  const parts = (path ?? "").split(/\s*[›>]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts[0] === UNCATEGORIZED) return { category: UNCATEGORIZED, subCategory: UNCATEGORIZED };
  const category = parts[0].slice(0, FAQ_LIMITS.category);
  const subCategory = (parts.slice(1).join("・") || parts[0]).slice(0, FAQ_LIMITS.category);
  return { category, subCategory };
}

// 答案拆成最多 3 個答案框（每框 500 字），盡量在換行或句號斷開
export function splitAnswer(answer: string): string[] {
  const boxes: string[] = [];
  let rest = answer.trim();
  while (rest && boxes.length < FAQ_LIMITS.answerBoxes) {
    if (rest.length <= FAQ_LIMITS.answerBox) {
      boxes.push(rest);
      rest = "";
      break;
    }
    const window = rest.slice(0, FAQ_LIMITS.answerBox);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf("。"), window.lastIndexOf("！"), window.lastIndexOf("？"));
    const end = cut > FAQ_LIMITS.answerBox / 2 ? cut + 1 : FAQ_LIMITS.answerBox;
    boxes.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  return boxes;
}

// 匯入前檢查：回傳超過長度、會被截斷的項目（給版本說明與畫面提示）
export function faqWarnings(items: FaqItem[]): string[] {
  const warnings: string[] = [];
  for (const f of items) {
    if (f.question.length > FAQ_LIMITS.question) warnings.push(`主問題超過 ${FAQ_LIMITS.question} 字：${f.question.slice(0, 30)}…`);
    if (f.answer.length > FAQ_ANSWER_MAX) warnings.push(`答案超過 ${FAQ_ANSWER_MAX} 字（會被截斷）：${f.question.slice(0, 30)}…`);
  }
  return warnings;
}

// 產生匯入用的 Excel（工作表與欄位照官方範本）
export async function buildFaqWorkbook(items: FaqItem[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import Template");
  sheet.columns = [
    { header: "Category", width: 18 },
    { header: "Sub-category", width: 16 },
    { header: "Main Question", width: 40 },
    { header: "Similar Sentence", width: 40 },
    { header: "Title", width: 24 },
    { header: "Answer Example 1", width: 60 },
    { header: "Answer Example 2", width: 60 },
    { header: "Answer Example 3", width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const f of items) {
    const boxes = splitAnswer(f.answer);
    const title = (f.title || f.question).slice(0, FAQ_LIMITS.title);
    const base = [
      f.category.slice(0, FAQ_LIMITS.category),
      f.subCategory.slice(0, FAQ_LIMITS.category),
      f.question.slice(0, FAQ_LIMITS.question),
    ];
    const tail = [title, boxes[0] ?? "", boxes[1] ?? "", boxes[2] ?? ""];
    const similar = f.similar.length > 0 ? f.similar : [""];
    for (const s of similar) sheet.addRow([...base, s.slice(0, FAQ_LIMITS.similar), ...tail]);
  }
  sheet.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// 給人看的 md（預覽、版本比較用）：依分類分組，每題列出相似句與答案
export function faqItemsToMarkdown(items: FaqItem[], title: string): string {
  const lines = [`# ${title}`, ""];
  let currentGroup = "";
  for (const f of items) {
    const group = `${f.category}｜${f.subCategory}`;
    if (group !== currentGroup) {
      lines.push(`## ${group}`, "");
      currentGroup = group;
    }
    lines.push(`### ${f.question}`, "");
    if (f.title) lines.push(`- 標題：${f.title}`);
    if (f.similar.length > 0) {
      lines.push("- 相似句：");
      for (const s of f.similar) lines.push(`  - ${s}`);
    }
    lines.push("", f.answer, "");
  }
  return lines.join("\n").trim();
}

// 比對用的正規化：去空白、標點，大小寫一致
export function looseQuestion(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

// 兩句是否「幾乎一樣」：正規化後相同，或其中一句包含另一句且長度差不到兩成
export function nearlySameQuestion(a: string, b: string): boolean {
  const x = looseQuestion(a);
  const y = looseQuestion(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length / long.length >= 0.8;
}
