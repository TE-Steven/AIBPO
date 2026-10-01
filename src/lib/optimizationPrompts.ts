import { ruleText, type PromptConfigData } from "@/lib/promptConfig";

// 自動優化的兩份提示詞（規則在 參數管理「自動優化」分頁可開關、可改）：
// 1. AI 依答錯清單修改 md　2. 為每一題產生相似問法

function ruleLines(config: PromptConfigData | undefined, ids: string[]): string {
  return ids
    .map((id) => ruleText(config, id))
    .filter((t): t is string => Boolean(t))
    .map((t) => `- ${t}`)
    .join("\n");
}

function guidelinesPrefix(guidelines?: string): string {
  return guidelines?.trim() ? `【最高準則，優先於本提示詞裡的其他任何指示，一定要遵守】\n${guidelines.trim()}\n\n---\n\n` : "";
}

export function buildRevisionSystemPrompt(params: { guidelines?: string; config?: PromptConfigData }): string {
  const { config } = params;
  return [
    `${guidelinesPrefix(params.guidelines)}${ruleText(config, "opt.intro")}`,
    ruleText(config, "opt.language"),
    `規則：\n${ruleLines(config, ["O1", "O2", "O3", "O4", "O5", "O6"])}`,
    ruleText(config, "O7"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type RevisionFailure = { question: string; expectedAnswer: string; botAnswer: string | null; reason: string | null };

// 修改 md 的 user 文字（原始文件以 document 區塊另外附上）
export function buildRevisionUserText(params: { markdown: string; failures: RevisionFailure[]; passedCount: number }): string {
  const failures = params.failures
    .map(
      (f, i) =>
        `<failure index="${i + 1}">\n<question>${f.question}</question>\n<expected_answer>${f.expectedAnswer}</expected_answer>\n<bot_answer>${f.botAnswer ?? "（機器人沒有回答）"}</bot_answer>\n<reason>${f.reason ?? "（沒有拿到回答）"}</reason>\n</failure>`,
    )
    .join("\n");
  return `以上是原始文件。\n\n<current_markdown>\n${params.markdown}\n</current_markdown>\n\n這一輪有 ${params.passedCount} 題答對、${params.failures.length} 題答錯，答錯的清單如下：\n\n${failures}\n\n請依照系統指示，輸出修改後的完整 md。`;
}

export function buildSimilarQuestionsSystemPrompt(params: { count: number; config?: PromptConfigData }): string {
  const { config } = params;
  return [ruleText(config, "sim.intro"), `每一題各寫 ${params.count} 個相似問法。`, `規則：\n${ruleLines(config, ["S1", "S2"])}`]
    .filter(Boolean)
    .join("\n\n");
}

// 相似題用 JSON Schema 強制輸出格式
export const SIMILAR_QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, questions: { type: "array", items: { type: "string" } } },
        required: ["index", "questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};
