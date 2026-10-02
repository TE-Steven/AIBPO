import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { findAiModel } from "@/lib/aiModels";
import { prisma } from "@/lib/db";
import { stripBotDisclaimer } from "@/lib/botTestShared";
import { buildJudgeSystemPrompt, buildKeyPointsSystemPrompt } from "@/lib/kmAnalysis";
import { resolveOptions, ruleText, type PromptConfigData } from "@/lib/promptConfig";
import { cleanKeyPoints, decideVerdict, type JudgeDetail, type JudgedPoint, type JudgeVerdict, type KeyPoint, type PointStatus } from "@/lib/keyPoints";

// 機器人測試的 AI 比對（關鍵答案版）：
// 1. 標準答案拆成關鍵答案（每個標準答案只拆一次，存 AnswerKeyPoints，原題與相似題共用）
// 2. AI 逐點標記機器人回答「有講到／沒講到／講錯」並引用原句，另列多講且講錯的內容
// 3. 是否一致由 decideVerdict 依參數管理的比對規則計算（src/lib/keyPoints.ts）

export type JudgeResult = { verdict: JudgeVerdict; reason: string | null; detail?: JudgeDetail };

const KEY_POINTS_SCHEMA = {
  type: "object",
  properties: {
    points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          required: { type: "boolean" },
          aliases: { type: "array", items: { type: "string" } },
        },
        required: ["text", "required", "aliases"],
        additionalProperties: false,
      },
    },
  },
  required: ["points"],
  additionalProperties: false,
};

const POINT_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          status: { type: "string", enum: ["COVERED", "MISSING", "WRONG"] },
          evidence: { type: "string" },
        },
        required: ["index", "status", "evidence"],
        additionalProperties: false,
      },
    },
    conflicts: { type: "array", items: { type: "string" } },
  },
  required: ["points", "conflicts"],
  additionalProperties: false,
};

// 標準答案正規化（去頭尾、合併空白）後的雜湊：同樣的標準答案共用同一組關鍵答案
export function answerHash(expectedAnswer: string): string {
  return createHash("sha256").update(expectedAnswer.trim().replace(/\s+/g, " ")).digest("hex");
}

function textOf(response: Anthropic.Message): string {
  if (response.stop_reason !== "end_turn") throw new Error("AI 回應沒有完成");
  return response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
}

// 拆關鍵答案固定用 Sonnet：它是之後每一輪的評分標準，品質比省錢重要
export async function extractKeyPoints(params: {
  question: string;
  expectedAnswer: string;
  roleId: string;
  config?: PromptConfigData;
}): Promise<KeyPoint[]> {
  const response = await anthropic.messages.create({
    model: KM_ANALYSIS_MODEL,
    max_tokens: 2000,
    system: buildKeyPointsSystemPrompt(params.config),
    output_config: { effort: "low", format: { type: "json_schema", schema: KEY_POINTS_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `<question>\n${params.question}\n</question>\n\n<expected_answer>\n${params.expectedAnswer}\n</expected_answer>`,
      },
    ],
  });
  await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "bot_test_keypoints", usage: response.usage, roleId: params.roleId });
  const points = cleanKeyPoints((JSON.parse(textOf(response)) as { points: unknown }).points);
  if (points.length === 0) throw new Error("AI 沒有拆出任何關鍵答案");
  return points;
}

// 同一批題目同時比對時（相似題共用標準答案），避免同一個標準答案被拆好幾次
const pendingExtractions = new Map<string, Promise<KeyPoint[]>>();

export async function getOrCreateKeyPoints(params: {
  roleId: string;
  question: string;
  expectedAnswer: string;
  config?: PromptConfigData;
}): Promise<KeyPoint[]> {
  const hash = answerHash(params.expectedAnswer);
  const existing = await prisma.answerKeyPoints.findUnique({ where: { roleId_answerHash: { roleId: params.roleId, answerHash: hash } } });
  const stored = existing ? cleanKeyPoints(existing.points) : [];
  if (stored.length > 0) return stored;

  const key = `${params.roleId}:${hash}`;
  let pending = pendingExtractions.get(key);
  if (!pending) {
    pending = (async () => {
      const points = await extractKeyPoints(params);
      await prisma.answerKeyPoints.upsert({
        where: { roleId_answerHash: { roleId: params.roleId, answerHash: hash } },
        create: { roleId: params.roleId, answerHash: hash, expectedAnswer: params.expectedAnswer, points },
        update: { points },
      });
      return points;
    })().finally(() => pendingExtractions.delete(key));
    pendingExtractions.set(key, pending);
  }
  return pending;
}

// 逐點標記：回傳每個關鍵答案的狀態與引用原句，以及多講且講錯的內容
export async function judgeWithKeyPoints(params: {
  question: string;
  keyPoints: KeyPoint[];
  botAnswer: string;
  roleId: string;
  config?: PromptConfigData;
  model?: string;
}): Promise<{ points: JudgedPoint[]; conflicts: string[] }> {
  const model = params.model ?? KM_ANALYSIS_MODEL;
  const list = params.keyPoints
    .map(
      (p, i) =>
        `<key_point index="${i + 1}" required="${p.required}">${p.text}${p.aliases.length > 0 ? `（可接受說法：${p.aliases.join("、")}）` : ""}</key_point>`,
    )
    .join("\n");
  const response = await anthropic.messages.create({
    model,
    max_tokens: 3000,
    system: buildJudgeSystemPrompt(params.config),
    output_config: {
      ...(findAiModel(model).effort ? { effort: "low" as const } : {}),
      format: { type: "json_schema", schema: POINT_JUDGE_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `<question>\n${params.question}\n</question>\n\n<key_points>\n${list}\n</key_points>\n\n<bot_answer>\n${stripBotDisclaimer(params.botAnswer)}\n</bot_answer>`,
      },
    ],
  });
  await recordApiUsage({ model, purpose: "bot_test_judge", usage: response.usage, roleId: params.roleId });

  const parsed = JSON.parse(textOf(response)) as { points: { index: number; status: string; evidence: string }[]; conflicts: string[] };
  const byIndex = new Map(parsed.points.map((p) => [p.index, p]));
  const points: JudgedPoint[] = params.keyPoints.map((kp, i) => {
    const judged = byIndex.get(i + 1);
    const status: PointStatus = judged && ["COVERED", "MISSING", "WRONG"].includes(judged.status) ? (judged.status as PointStatus) : "MISSING";
    return { text: kp.text, required: kp.required, status, evidence: status === "MISSING" ? "" : (judged?.evidence ?? "").trim().slice(0, 500) };
  });
  // 參數管理關掉「多講且講錯」（P3）時不列入判定
  const conflicts = ruleText(params.config, "P3")
    ? parsed.conflicts.map((c) => c.trim()).filter(Boolean).slice(0, 10)
    : [];
  return { points, conflicts };
}

export async function judgeBotAnswer(params: {
  question: string;
  expectedAnswer: string;
  botAnswer: string;
  roleId: string;
  // 公司在 參數管理調整的比對規則與提示詞；沒給就用預設
  config?: PromptConfigData;
  // 逐點比對用的模型（自動優化可選）；拆關鍵答案固定用 Sonnet
  model?: string;
}): Promise<JudgeResult> {
  try {
    const keyPoints = await getOrCreateKeyPoints(params);
    const { points, conflicts } = await judgeWithKeyPoints({ ...params, keyPoints });
    const options = resolveOptions(params.config);
    const decided = decideVerdict(points, conflicts, { minCoverage: options.judgeMinCoverage, wrongTolerance: options.judgeWrongTolerance });
    return { verdict: decided.verdict, reason: decided.reason, detail: { points, conflicts, coverage: decided.coverage } };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { verdict: "ERROR", reason: `AI 比對失敗（${err.status ?? "連線錯誤"}），請按「重新比對」再試一次。` };
    }
    return { verdict: "ERROR", reason: `AI 比對失敗（${err instanceof Error ? err.message : "未知錯誤"}），請按「重新比對」再試一次。` };
  }
}
