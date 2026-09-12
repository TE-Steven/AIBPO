import type Anthropic from "@anthropic-ai/sdk";
import type { KmSource, Tally } from "@/generated/prisma/client";

export type FaqDraft = { question: string; answer: string; suggestedTally: string | null };

export function buildSystemPrompt(params: {
  dimensions: string[];
  tallies: Tally[];
  countMin: number;
  countMax: number;
}): string {
  const { dimensions, tallies, countMin, countMax } = params;

  const dimensionsText =
    dimensions.length > 0
      ? dimensions.map((d) => `- ${d}`).join("\n")
      : "（使用者沒有指定特定維度，請你自行判斷內容中最值得整理成 FAQ 的重點）";

  const tallyText =
    tallies.length > 0
      ? `\n你也可以參考以下分類清單，為每一題建議最適合歸類的分類名稱（從清單中選一個最貼近的名稱，完全比對不到就填 null，不要自己發明新分類名稱）：\n${tallies
          .map((t) => `- ${t.name}`)
          .join("\n")}\n`
      : "";

  return `你是知識庫建置助手（Knowledge Management）。使用者會提供一份文件或一個網頁，你要仔細閱讀全文內容，根據下面指定的「分析維度」，找出所有適合整理成 FAQ（常見問題集）的題目與答案組合。

分析維度：
${dimensionsText}
${tallyText}
請產出介於 ${countMin} 到 ${countMax} 題之間的 FAQ，每一題必須：
- 題目要像真實使用者會問的問題，具體、口語化
- 答案要根據文件內容回答，不要虛構或超出文件範圍的內容
- 同一個題目不要重複出現

完成你的分析與思考後，在回應的最後面，輸出一個 \`\`\`json 區塊（只能有這一個 json 區塊），內容是一個陣列，格式如下，不要在 json 區塊內加註解或其他文字：

\`\`\`json
[{"question": "...", "answer": "...", "suggestedTally": "分類名稱或 null"}]
\`\`\``;
}

export function buildUserContent(source: KmSource): Anthropic.MessageParam["content"] {
  if (source.sourceType === "PDF" && source.sourceFileId) {
    return [
      { type: "document", source: { type: "file", file_id: source.sourceFileId } },
      { type: "text", text: "請分析這份 PDF 文件，依照系統指示產出 FAQ。" },
    ];
  }

  return [
    {
      type: "text",
      text: `請抓取並分析這個網址的內容，依照系統指示產出 FAQ：${source.sourceUrl}`,
    },
  ];
}

export function parseFaqDrafts(text: string): FaqDraft[] {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  const jsonText = match ? match[1] : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && typeof item.question === "string" && typeof item.answer === "string",
    )
    .map((item) => ({
      question: String(item.question).trim(),
      answer: String(item.answer).trim(),
      suggestedTally:
        typeof item.suggestedTally === "string" && item.suggestedTally.trim() && item.suggestedTally !== "null"
          ? item.suggestedTally.trim()
          : null,
    }))
    .filter((f) => f.question && f.answer);
}
