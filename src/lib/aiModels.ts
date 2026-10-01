// 可選的 Claude 模型與定價（每百萬 token，美元）。前後端共用：畫面算預估費用、後端呼叫與記錄用量都看這份。
// adaptiveThinking／effort：模型是否支援自適應思考與 effort 參數（不支援的就不送，改用固定思考預算或不思考）。

export type AiModel = {
  id: string;
  label: string;
  hint: string;
  input: number;
  output: number;
  adaptiveThinking: boolean;
  effort: boolean;
};

export const AI_MODELS: AiModel[] = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", hint: "最便宜、最快", input: 1, output: 5, adaptiveThinking: false, effort: false },
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "目前預設", input: 2, output: 10, adaptiveThinking: true, effort: true },
  { id: "claude-opus-5", label: "Opus 5", hint: "最強、最貴", input: 5, output: 25, adaptiveThinking: true, effort: true },
];

export const DEFAULT_AI_MODEL = "claude-sonnet-5";

export function findAiModel(id: string | null | undefined): AiModel {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS.find((m) => m.id === DEFAULT_AI_MODEL)!;
}

// 不認得的模型 id 一律換成預設，避免從表單塞進任意值
export function cleanAiModel(id: unknown): string {
  return typeof id === "string" && AI_MODELS.some((m) => m.id === id) ? id : DEFAULT_AI_MODEL;
}

export function modelCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const m = findAiModel(modelId);
  return (inputTokens * m.input + outputTokens * m.output) / 1_000_000;
}
