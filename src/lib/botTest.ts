import { randomUUID } from "node:crypto";
import { getSystemSetting, BOT_TEST_TARGET_KEY } from "@/lib/systemSettings";

// 機器人測試：把 KM 題目送去現行 telligent chatbot，再撈回機器人的回答。
// token 是使用者每次測試時貼上的 telligent access token（約 1 小時效期），只在記憶體裡用，不存 DB、不寫 log。

export type BotTestTarget = {
  workflowBaseUrl: string;
  gatewayBaseUrl: string;
  platformId: string;
};

export const DEFAULT_BOT_TEST_TARGET: BotTestTarget = {
  workflowBaseUrl: "https://uat.telligentbiz.com",
  gatewayBaseUrl: "https://gw-uat.telligentbiz.com",
  platformId: "",
};

// 送題後等多久才去撈答案、撈不到再隔多久重試、最多重試幾次。
const ANSWER_WAIT_MS = 30_000;
const ANSWER_MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000;

export async function getBotTestTarget(companyId: string): Promise<BotTestTarget | null> {
  const raw = await getSystemSetting(companyId, BOT_TEST_TARGET_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BotTestTarget>;
    if (!parsed.workflowBaseUrl || !parsed.gatewayBaseUrl || !parsed.platformId) return null;
    return {
      workflowBaseUrl: parsed.workflowBaseUrl,
      gatewayBaseUrl: parsed.gatewayBaseUrl,
      platformId: parsed.platformId,
    };
  } catch {
    return null;
  }
}

export class BotTokenError extends Error {}

type TokenClaims = {
  tenantId: string;
  corporationId: string;
  companyId: string;
  companyCode: string;
};

// 只讀 token 裡的 claims（不驗簽，驗證交給 telligent 自己的 API），順便先擋掉過期或格式不對的 token。
export function decodeTokenClaims(token: string): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new BotTokenError("token 格式不正確，請貼上完整的 access token。");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new BotTokenError("token 格式不正確，請貼上完整的 access token。");
  }
  const exp = Number(payload.exp);
  if (exp && exp * 1000 < Date.now()) throw new BotTokenError("token 已過期，請換一個新的 token。");

  const claims = {
    tenantId: String(payload.tenant ?? ""),
    corporationId: String(payload.corporation ?? ""),
    companyId: String(payload.company ?? ""),
    companyCode: String(payload.company_code ?? ""),
  };
  if (!claims.tenantId || !claims.corporationId || !claims.companyId || !claims.companyCode) {
    throw new BotTokenError("token 裡缺少公司資訊（tenant / corporation / company / company_code），請確認是正確的 token。");
  }
  return claims;
}

function maskToken(message: string, token: string): string {
  return token ? message.split(token).join("***") : message;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callApi(url: string, token: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    throw new BotTokenError("token 無效或已過期，請換一個新的 token。");
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 200)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

type UnreadingDetail = { sender?: number; message?: string; chatId?: string; time?: number };

async function fetchBotAnswer(
  target: BotTestTarget,
  claims: TokenClaims,
  token: string,
  customerId: string,
): Promise<{ chatId: string | null; answer: string } | null> {
  const params = new URLSearchParams({
    channelId: target.platformId,
    customerId,
    companyId: claims.companyId,
    chatTo: "2",
  });
  const url = `${target.gatewayBaseUrl}/${encodeURIComponent(claims.companyCode)}/communication/api/v1/customer/unreading?${params}`;
  const json = (await callApi(url, token)) as { data?: { details?: UnreadingDetail[] } };
  const details = json.data?.details ?? [];
  const botMessages = details
    .filter((d) => d.sender === 3 && d.message)
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  if (botMessages.length === 0) return null;
  return {
    chatId: botMessages[0].chatId ?? details[0]?.chatId ?? null,
    answer: botMessages.map((d) => d.message).join("\n\n"),
  };
}

export type AskResult =
  | { status: "ANSWERED"; customerId: string; chatId: string | null; answer: string }
  | { status: "TIMEOUT"; customerId: string }
  | { status: "ERROR"; customerId: string; errorMessage: string };

// 一題：用全新的 customerId 送題 → 等 30 秒撈答案，撈不到再等 30 秒重試，最多重試 3 次。
// token 失效會直接往外丟 BotTokenError，讓呼叫端整批停下來。
export async function askBot(target: BotTestTarget, token: string, question: string): Promise<AskResult> {
  const claims = decodeTokenClaims(token);
  const customerId = randomUUID();

  try {
    await callApi(`${target.workflowBaseUrl}/workflowapi/api/workflow/chat/start`, token, {
      method: "POST",
      body: JSON.stringify({
        tenantId: claims.tenantId,
        corporationId: claims.corporationId,
        companyId: claims.companyId,
        platformId: target.platformId,
        companyCode: claims.companyCode,
        userId: customerId,
        messageTime: Date.now(),
        replyToken: randomUUID(),
        message: question,
        messageType: "text",
        chatActionType: 1,
      }),
    });

    for (let attempt = 0; attempt <= ANSWER_MAX_RETRIES; attempt++) {
      await sleep(ANSWER_WAIT_MS);
      const found = await fetchBotAnswer(target, claims, token, customerId);
      if (found) return { status: "ANSWERED", customerId, ...found };
    }
    return { status: "TIMEOUT", customerId };
  } catch (err) {
    if (err instanceof BotTokenError) throw err;
    const message = err instanceof Error ? err.message : "未知錯誤";
    return { status: "ERROR", customerId, errorMessage: maskToken(message, token) };
  }
}
