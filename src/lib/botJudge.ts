import Anthropic from "@anthropic-ai/sdk";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { findAiModel } from "@/lib/aiModels";
import { stripBotDisclaimer } from "@/lib/botTestShared";
import { buildJudgeSystemPrompt } from "@/lib/kmAnalysis";
import type { PromptConfigData } from "@/lib/promptConfig";

// 機器人測試的 AI 比對：判斷機器人回答跟標準答案意思是否一致，不一致就說明差在哪裡。

export type JudgeResult = { verdict: "MATCH" | "MISMATCH" | "ERROR"; reason: string | null };

// 比對用的系統提示詞由 參數管理的設定組成（buildJudgeSystemPrompt，規則 J1–J4）

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    match: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["match", "reason"],
  additionalProperties: false,
};

export async function judgeBotAnswer(params: {
  question: string;
  expectedAnswer: string;
  botAnswer: string;
  roleId: string;
  // 公司在 參數管理調整的比對標準；沒給就用預設
  config?: PromptConfigData;
  // 比對用的模型（自動優化可選）；沒給就用預設
  model?: string;
}): Promise<JudgeResult> {
  const model = params.model ?? KM_ANALYSIS_MODEL;
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      system: buildJudgeSystemPrompt(params.config),
      output_config: {
        ...(findAiModel(model).effort ? { effort: "low" as const } : {}),
        format: { type: "json_schema", schema: JUDGE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `<question>\n${params.question}\n</question>\n\n<expected_answer>\n${params.expectedAnswer}\n</expected_answer>\n\n<bot_answer>\n${stripBotDisclaimer(params.botAnswer)}\n</bot_answer>`,
        },
      ],
    });

    await recordApiUsage({ model, purpose: "bot_test_judge", usage: response.usage, roleId: params.roleId });

    if (response.stop_reason !== "end_turn") {
      return { verdict: "ERROR", reason: "AI 比對沒有完成，請按「重新比對」再試一次。" };
    }
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { match: boolean; reason: string };
    return parsed.match
      ? { verdict: "MATCH", reason: null }
      : { verdict: "MISMATCH", reason: parsed.reason.trim() || "與標準答案不一致" };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { verdict: "ERROR", reason: `AI 比對失敗（${err.status ?? "連線錯誤"}），請按「重新比對」再試一次。` };
    }
    return { verdict: "ERROR", reason: "AI 比對失敗，請按「重新比對」再試一次。" };
  }
}
