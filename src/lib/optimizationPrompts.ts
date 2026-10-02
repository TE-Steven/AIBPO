import { ruleText, type PromptConfigData } from "@/lib/promptConfig";

// 自動優化的提示詞（規則在 參數管理「自動優化」分頁可開關、可改）：
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
// 結構化文件上傳時會依 H1 切成多個檔案：修改時一定要保留每個 H1（這是系統運作需要，不放進可調整的規則）
const SPLIT_BY_H1_NOTE =
  "注意：這份 md 的每一個「# 標題」（H1）是一份獨立的文件，上傳時會依 H1 切成多個檔案、各自讓機器人學習。請保留每一個 H1 的名稱與順序，不要合併、刪除、改名或新增 H1；每份文件都要能單獨閱讀，不要出現「同上」「見上一份」這類跨文件的寫法。";

export function buildRevisionUserText(params: {
  markdown: string;
  failures: RevisionFailure[];
  passedCount: number;
  splitByH1?: boolean;
}): string {
  const failures = params.failures
    .map(
      (f, i) =>
        `<failure index="${i + 1}">\n<question>${f.question}</question>\n<expected_answer>${f.expectedAnswer}</expected_answer>\n<bot_answer>${f.botAnswer ?? "（機器人沒有回答）"}</bot_answer>\n<reason>${f.reason ?? "（沒有拿到回答）"}</reason>\n</failure>`,
    )
    .join("\n");
  const note = params.splitByH1 ? `\n\n${SPLIT_BY_H1_NOTE}` : "";
  return `以上是原始文件。\n\n<current_markdown>\n${params.markdown}\n</current_markdown>\n\n這一輪有 ${params.passedCount} 題答對、${params.failures.length} 題答錯，答錯的清單如下：\n\n${failures}\n\n請依照系統指示，輸出修改後的完整 md。${note}`;
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

// ---------------- 診斷原因＋局部修改（預設做法） ----------------

export type EditCause = "MISSING_INFO" | "HARD_TO_FIND" | "AMBIGUOUS" | "NOT_IN_SOURCE" | "RETRIEVAL";

export const EDIT_CAUSE_LABELS: Record<EditCause, string> = {
  MISSING_INFO: "md 沒寫到",
  HARD_TO_FIND: "寫了但找不到",
  AMBIGUOUS: "寫得矛盾或模糊",
  NOT_IN_SOURCE: "原文就沒有",
  RETRIEVAL: "機器人本身的問題",
};

export function buildEditSystemPrompt(params: { guidelines?: string; config?: PromptConfigData }): string {
  const { config } = params;
  return [
    `${guidelinesPrefix(params.guidelines)}${ruleText(config, "ed.intro")}`,
    ruleText(config, "opt.language"),
    `規則：\n${ruleLines(config, ["E1", "E2", "E3", "E4", "E5", "E6", "E7"])}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type EditFailure = {
  question: string;
  expectedAnswer: string;
  botAnswer: string | null;
  verdict: string | null;
  missing: string[];
  wrong: string[];
  conflicts: string[];
  reason: string | null;
  // 使用者在逐題結果寫的備註
  userNote: string | null;
};

export function buildEditUserText(params: { markdown: string; failures: EditFailure[]; splitByH1?: boolean }): string {
  const failures = params.failures
    .map((f, i) => {
      const lines = [
        `<failure index="${i + 1}">`,
        `<question>${f.question}</question>`,
        `<expected_answer>${f.expectedAnswer}</expected_answer>`,
        `<bot_answer>${f.botAnswer ?? "（機器人沒有回答）"}</bot_answer>`,
        f.missing.length > 0 ? `<missing_key_points>${f.missing.join("；")}</missing_key_points>` : "",
        f.wrong.length > 0 ? `<wrong_key_points>${f.wrong.join("；")}</wrong_key_points>` : "",
        f.conflicts.length > 0 ? `<conflicts>${f.conflicts.join("；")}</conflicts>` : "",
        f.missing.length + f.wrong.length + f.conflicts.length === 0 && f.reason ? `<reason>${f.reason}</reason>` : "",
        f.userNote ? `<user_note>${f.userNote}</user_note>` : "",
        `</failure>`,
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n");
  const note = params.splitByH1 ? `\n\n${SPLIT_BY_H1_NOTE}` : "";
  return `以上是原始文件。\n\n<current_markdown>\n${params.markdown}\n</current_markdown>\n\n以下是機器人答錯的 ${params.failures.length} 題：\n\n${failures}\n\n請依照系統指示，先為每一題寫出 diagnoses（index 對應題號），再列出要套用到 md 的 edits。${note}`;
}

export const EDIT_SCHEMA = {
  type: "object",
  properties: {
    diagnoses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          cause: { type: "string", enum: ["MISSING_INFO", "HARD_TO_FIND", "AMBIGUOUS", "NOT_IN_SOURCE", "RETRIEVAL"] },
          note: { type: "string" },
        },
        required: ["index", "cause", "note"],
        additionalProperties: false,
      },
    },
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["replace", "insert_after", "delete"] },
          anchor: { type: "string" },
          text: { type: "string" },
          reason: { type: "string" },
          questions: { type: "array", items: { type: "integer" } },
        },
        required: ["action", "anchor", "text", "reason", "questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["diagnoses", "edits"],
  additionalProperties: false,
};

// 每一版的修改紀錄（KbVersion.revisionLog）
export type RevisionLog = {
  mode: "edits" | "rewrite";
  baseVersionId: string;
  baseVersionName: string;
  diagnoses: { question: string; cause: EditCause; note: string }[];
  edits: { action: string; anchor: string; text: string; reason: string; questions: string[]; applied: boolean }[];
  growthPct: number;
};
