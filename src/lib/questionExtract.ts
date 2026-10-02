import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, recordApiUsage } from "@/lib/anthropic";

// 題目來源（例如客服對話紀錄）太長、AI 一次讀不完時：切成很多段，用 Haiku 從每一段萃取客戶問的問題，
// 再合併相同的問題、累計出現次數，存成一份精簡的問題清單（產生 FAQ 時優先挑問最多次的）。

// 超過這個字數才先萃取；更短的整份直接給產生 FAQ 的 AI 讀
export const QUESTION_EXTRACT_THRESHOLD = 300_000;
// 題目來源最多讀這麼多字（Excel 已拿掉 ID、時間等欄位），更長的只讀前面；約 3～5 分鐘、Haiku 費用約 US$8
export const QUESTION_SOURCE_MAX_CHARS = 10_000_000;

const MODEL = "claude-haiku-4-5-20251001";
// 合併相近說法只有一次呼叫、Haiku 容易漏併，用 Sonnet
const MERGE_MODEL = "claude-sonnet-5";
const CHUNK_CHARS = 100_000; // Haiku 一次讀得完、輸出也不會太長
const CONCURRENCY = 8;
// 交給 AI 合併相近說法的題數上限（次數最多的優先），也是最後清單的上限
const MAX_QUESTIONS = 1_000;

const SYSTEM = `你負責整理客服對話紀錄。使用者會給你一段對話紀錄（可能是表格），請列出「客戶」提出的問題：
- 只列客戶問的問題，客服的回答不要列
- 問的對象不同（不同產品、型號、服務）就是不同題，不要合併，問句裡要寫出是哪個產品
- 意思相同的問題合併成一題，count 填這段紀錄裡出現的次數（行尾的「（×N）」表示同樣這行出現了 N 次，要算進去）
- 改寫成清楚、完整、可以單獨看懂的問句（補上產品名稱等必要的上下文）
- 去掉姓名、電話、地址、訂單編號等個人資料
- 打招呼、閒聊、只有抱怨沒有問題的內容不要列
請全程使用繁體中文。`;

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, count: { type: "integer" } },
        required: ["question", "count"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

// 依換行切段，盡量不要把一筆對話切到兩段
function splitChunks(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > start + CHUNK_CHARS / 2) end = newline + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

// 合併用的鍵：去掉空白與標點，大小寫一致
function questionKey(q: string): string {
  return q.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

async function extractChunk(chunk: string, roleId: string | null): Promise<{ question: string; count: number }[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16_000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: `<chat_log>\n${chunk}\n</chat_log>` }],
  });
  await recordApiUsage({ model: MODEL, purpose: "km_question_extract", usage: response.usage, roleId });
  if (response.stop_reason === "max_tokens") throw new Error("AI 萃取問題時輸出被截斷，請把檔案拆小一點再試。");
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { questions: { question: string; count: number }[] };
  return parsed.questions.filter((q) => q.question?.trim());
}

const MERGE_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        // subject：這組問的對象（產品／型號／服務），讓 AI 先確認組內對象相同，避免把不同產品的同類問題併在一起
        properties: { subject: { type: "string" }, ids: { type: "array", items: { type: "integer" } } },
        required: ["subject", "ids"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
};

// 各段分開萃取時，同一個問題會有不同說法：最後再請 AI 把意思相同的合併，次數加總（失敗就保留原本的清單）
async function mergeSimilar(
  items: { question: string; count: number }[],
  roleId: string | null,
): Promise<{ question: string; count: number }[]> {
  if (items.length < 2) return items;
  try {
    const response = await anthropic.messages
      .stream({
        model: MERGE_MODEL,
        max_tokens: 32_000,
        system:
          "使用者會給你一份編號的客戶問題清單。請找出「重複」的問題：問的對象完全相同（同一個產品／型號／服務），想知道的事情也相同，只是說法不同。例如「A3清淨機濾網多久要換？」和「A3清淨機濾網更換頻率是？」是重複；但「A3清淨機濾網多久要換？」和「D9除濕機濾網多久要換？」問的是不同產品，絕對不是重複。每組寫出 subject（這組問的是哪個產品／服務）和 ids（編號）。只列有 2 題以上的組；沒有重複的題目不要列；一個編號最多出現在一組；拿不準的不要併。",
        output_config: { effort: "low", format: { type: "json_schema", schema: MERGE_SCHEMA } },
        messages: [{ role: "user", content: items.map((q, i) => `${i + 1}. ${q.question}`).join("\n") }],
      })
      .finalMessage();
    await recordApiUsage({ model: MERGE_MODEL, purpose: "km_question_extract", usage: response.usage, roleId });
    if (response.stop_reason === "max_tokens") return items;
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    const { groups } = JSON.parse(text) as { groups: { subject: string; ids: number[] }[] };
    const used = new Set<number>();
    const merged: { question: string; count: number }[] = [];
    for (const g of groups) {
      const ids = [...new Set(g.ids)].filter((id) => id >= 1 && id <= items.length && !used.has(id)).sort((a, b) => a - b);
      if (ids.length < 2) continue;
      ids.forEach((id) => used.add(id));
      // 清單依次數排序，用次數最多的說法當代表
      merged.push({ question: items[ids[0] - 1].question, count: ids.reduce((n, id) => n + items[id - 1].count, 0) });
    }
    // 沒有被合併的照原樣保留
    items.forEach((q, i) => {
      if (!used.has(i + 1)) merged.push(q);
    });
    return merged.sort((a, b) => b.count - a.count);
  } catch {
    return items;
  }
}

// 回傳要上傳的問題清單文字（依出現次數排序）
export async function extractQuestionsFromText(text: string, fileName: string, roleId: string | null, truncated = false): Promise<string> {
  const chunks = splitChunks(text);
  const results: { question: string; count: number }[][] = new Array(chunks.length);
  let next = 0;
  let failed = 0;
  let lastError: unknown = null;
  async function worker() {
    while (next < chunks.length) {
      const i = next++;
      // 個別段落失敗就跳過，不要整份重來
      try {
        results[i] = await extractChunk(chunks[i], roleId);
      } catch (err) {
        failed++;
        lastError = err;
        results[i] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  if (failed > chunks.length * 0.2) {
    throw new Error(`AI 萃取問題時有 ${failed}／${chunks.length} 段失敗：${lastError instanceof Error ? lastError.message : "未知錯誤"}`);
  }

  const merged = new Map<string, { question: string; count: number }>();
  for (const q of results.flat()) {
    const key = questionKey(q.question);
    if (!key) continue;
    const cur = merged.get(key);
    if (cur) cur.count += Math.max(1, q.count);
    else merged.set(key, { question: q.question.trim(), count: Math.max(1, q.count) });
  }
  const sorted = await mergeSimilar([...merged.values()].sort((a, b) => b.count - a.count).slice(0, MAX_QUESTIONS), roleId);
  if (sorted.length === 0) throw new Error(`「${fileName}」裡沒有找到客戶的問題。`);
  const scope = truncated ? `檔案太長，只讀了前 ${Math.round(text.length / 10000)} 萬字` : `約 ${Math.round(text.length / 10000)} 萬字`;
  return [
    `【原始檔案：${fileName}】客服對話紀錄（${scope}）已先由 AI 萃取出客戶問題，共 ${sorted.length} 題，依出現次數排序（括號內是次數）：`,
    "",
    ...sorted.map((q, i) => `${i + 1}. ${q.question}（${q.count} 次）`),
  ].join("\n");
}
