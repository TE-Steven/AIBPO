import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, recordApiUsage } from "@/lib/anthropic";

// 題目來源（例如客服對話紀錄）太長、AI 一次讀不完時：切成很多段，用 Haiku 從每一段萃取客戶問的問題，
// 再合併相同的問題、累計出現次數，存成一份精簡的問題清單（產生 FAQ 時優先挑問最多次的）。

// 超過這個字數才先萃取；更短的整份直接給產生 FAQ 的 AI 讀
export const QUESTION_EXTRACT_THRESHOLD = 300_000;
// 題目來源檔案的上限（約幾萬筆對話）
export const QUESTION_SOURCE_MAX_CHARS = 3_000_000;

const MODEL = "claude-haiku-4-5-20251001";
const CHUNK_CHARS = 100_000; // Haiku 一次讀得完、輸出也不會太長
const CONCURRENCY = 6;
const MAX_QUESTIONS = 3_000;

const SYSTEM = `你負責整理客服對話紀錄。使用者會給你一段對話紀錄（可能是表格），請列出「客戶」提出的問題：
- 只列客戶問的問題，客服的回答不要列
- 意思相同的問題合併成一題，count 填這段紀錄裡出現的次數
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
        properties: { question: { type: "string" }, ids: { type: "array", items: { type: "integer" } } },
        required: ["question", "ids"],
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
        model: MODEL,
        max_tokens: 64_000,
        system:
          "使用者會給你一份編號的客戶問題清單。請把意思相同（問的是同一件事）的問題合併成一組：question 寫一個最清楚的說法，ids 列出這組包含的所有編號。每個編號都要出現、而且只出現在一組；意思不同的不要硬併。請全程使用繁體中文。",
        output_config: { format: { type: "json_schema", schema: MERGE_SCHEMA } },
        messages: [{ role: "user", content: items.map((q, i) => `${i + 1}. ${q.question}`).join("\n") }],
      })
      .finalMessage();
    await recordApiUsage({ model: MODEL, purpose: "km_question_extract", usage: response.usage, roleId });
    if (response.stop_reason === "max_tokens") return items;
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    const { groups } = JSON.parse(text) as { groups: { question: string; ids: number[] }[] };
    const used = new Set<number>();
    const merged: { question: string; count: number }[] = [];
    for (const g of groups) {
      const ids = g.ids.filter((id) => id >= 1 && id <= items.length && !used.has(id));
      if (ids.length === 0) continue;
      ids.forEach((id) => used.add(id));
      merged.push({ question: g.question.trim() || items[ids[0] - 1].question, count: ids.reduce((n, id) => n + items[id - 1].count, 0) });
    }
    // AI 漏掉的編號照原樣保留
    items.forEach((q, i) => {
      if (!used.has(i + 1)) merged.push(q);
    });
    return merged.sort((a, b) => b.count - a.count);
  } catch {
    return items;
  }
}

// 回傳要上傳的問題清單文字（依出現次數排序）
export async function extractQuestionsFromText(text: string, fileName: string, roleId: string | null): Promise<string> {
  const chunks = splitChunks(text);
  const results: { question: string; count: number }[][] = new Array(chunks.length);
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const i = next++;
      results[i] = await extractChunk(chunks[i], roleId);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));

  const merged = new Map<string, { question: string; count: number }>();
  for (const q of results.flat()) {
    const key = questionKey(q.question);
    if (!key) continue;
    const cur = merged.get(key);
    if (cur) cur.count += Math.max(1, q.count);
    else merged.set(key, { question: q.question.trim(), count: Math.max(1, q.count) });
  }
  const sorted = (await mergeSimilar([...merged.values()].sort((a, b) => b.count - a.count).slice(0, MAX_QUESTIONS), roleId)).slice(0, MAX_QUESTIONS);
  if (sorted.length === 0) throw new Error(`「${fileName}」裡沒有找到客戶的問題。`);
  return [
    `【原始檔案：${fileName}】客服對話紀錄（約 ${Math.round(text.length / 10000)} 萬字）已先由 AI 萃取出客戶問題，共 ${sorted.length} 題，依出現次數排序（括號內是次數）：`,
    "",
    ...sorted.map((q, i) => `${i + 1}. ${q.question}（${q.count} 次）`),
  ].join("\n");
}
