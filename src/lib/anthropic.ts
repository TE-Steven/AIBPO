import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";

export const anthropic = new Anthropic();

export const KM_ANALYSIS_MODEL = "claude-sonnet-5";

/** Claude Sonnet 5 定價（每百萬 token，美元）：input $2 / output $10。 */
const PRICE_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
};

// 沒有即時匯率來源，先用固定值估算，之後有需要再接真實匯率 API。
export const USD_TO_TWD_RATE = 32;

export async function recordApiUsage(params: {
  model: string;
  purpose: string;
  usage: Anthropic.Usage;
  roleId?: string | null;
}): Promise<void> {
  await prisma.apiUsageLog.create({
    data: {
      model: params.model,
      purpose: params.purpose,
      inputTokens: params.usage.input_tokens,
      outputTokens: params.usage.output_tokens,
      cacheReadTokens: params.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: params.usage.cache_creation_input_tokens ?? 0,
      roleId: params.roleId ?? null,
    },
  });
}

export function estimateUsdCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_PER_MILLION_USD[model];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}
