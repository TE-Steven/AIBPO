import Anthropic from "@anthropic-ai/sdk";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { stripBotDisclaimer } from "@/lib/botTestShared";

// 機器人測試的 AI 比對：判斷機器人回答跟標準答案意思是否一致，不一致就說明差在哪裡。

export type JudgeResult = { verdict: "MATCH" | "MISMATCH" | "ERROR"; reason: string | null };

const JUDGE_SYSTEM = `你是客服知識庫的品質檢查員。使用者會給你一題客服問題、標準答案，以及客服機器人的實際回答。
請判斷機器人回答跟標準答案是否一致：
- 重點是「意思」與「關鍵資訊」（數字、條件、步驟、限制、注意事項），用字、語氣、排版、順序不同都不算不一致。
- 機器人多補充了不衝突的資訊，只要標準答案的關鍵資訊都有講到、沒有講錯，仍算一致。
- 以下算不一致：漏掉標準答案裡的關鍵資訊、數字或條件講錯、意思相反或答非所問、回答「不知道」或要客戶另洽客服。
- 不一致時，reason 用繁體中文一到兩句具體說明差異（例如「少回答到保固期限 2 年」「把 100 公分講成 120 公分」）；一致時 reason 填空字串。`;

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
}): Promise<JudgeResult> {
  try {
    const response = await anthropic.messages.create({
      model: KM_ANALYSIS_MODEL,
      max_tokens: 2000,
      system: JUDGE_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `<question>\n${params.question}\n</question>\n\n<expected_answer>\n${params.expectedAnswer}\n</expected_answer>\n\n<bot_answer>\n${stripBotDisclaimer(params.botAnswer)}\n</bot_answer>`,
        },
      ],
    });

    await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "bot_test_judge", usage: response.usage, roleId: params.roleId });

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
