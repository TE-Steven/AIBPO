import { randomUUID } from "node:crypto";
import { getSystemSetting, BOT_TEST_TARGET_KEY } from "@/lib/systemSettings";

// 機器人測試：把 KM 題目送去現行 telligent chatbot，再撈回機器人的回答。
// token 是使用者每次測試時貼上的 telligent access token（約 1 小時效期），只在記憶體裡用，不存 DB、不寫 log。

// 一間公司可以設定多隻要問的機器人（每隻：送題網址、取答案網址、channel）；
// md 一律上傳到同一個知識庫，所以知識庫 platformId、上傳／知識庫路徑與自動換 token 的設定全公司共用。
export type BotProfile = {
  id: string;
  name: string;
  description: string;
  workflowBaseUrl: string;
  gatewayBaseUrl: string;
  platformId: string;
};

export type BotSharedSettings = {
  // 自動優化上傳 md 用的知識庫 platform（全公司同一個；沒填就不能用自動優化）
  knowledgePlatformId: string;
  // 路徑裡的 {code} 會換成 token 的 company_code
  uploadPath: string;
  knowledgePath: string;
  // 自動換 token（refresh token 換 access token）：token 網址留空就用 {送題網址}/oauth2api/connect/token
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  // 換 token 時要一起帶的公司資訊（telligent 的 token 服務沒帶會回 HTTP 500）
  tokenCompanyId: string;
  tokenCompanyCode: string;
};

export type BotTestSettings = BotSharedSettings & { bots: BotProfile[] };

// 實際呼叫 API 用的設定：選定的那隻機器人＋共用設定
export type BotTestTarget = BotSharedSettings & Omit<BotProfile, "id" | "name" | "description"> & { botId: string; botName: string };

// 給畫面下拉選單用（不含任何密碼）
export type BotOption = { id: string; name: string; description: string; channel: string };

export const DEFAULT_UPLOAD_PATH = "/{code}/file/api/file/upload";
export const DEFAULT_KNOWLEDGE_PATH = "/{code}/knowledge/api/GenerativeKnowledge";

export const DEFAULT_SHARED_SETTINGS: BotSharedSettings = {
  knowledgePlatformId: "",
  uploadPath: DEFAULT_UPLOAD_PATH,
  knowledgePath: DEFAULT_KNOWLEDGE_PATH,
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  tokenCompanyId: "",
  tokenCompanyCode: "",
};

export const DEFAULT_BOT_PROFILE: Omit<BotProfile, "id"> = {
  name: "預設機器人",
  description: "",
  workflowBaseUrl: "https://uat.telligentbiz.com",
  gatewayBaseUrl: "https://gw-uat.telligentbiz.com",
  platformId: "",
};

// 送題後等多久才去撈答案、撈不到再隔多久重試、最多重試幾次。
const ANSWER_WAIT_MS = 30_000;
const ANSWER_MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// 讀公司的機器人設定；舊格式（單一機器人的欄位放在最上層）自動轉成第一隻「預設機器人」
export async function getBotTestSettings(companyId: string): Promise<BotTestSettings | null> {
  const raw = await getSystemSetting(companyId, BOT_TEST_TARGET_KEY);
  return raw ? parseBotTestSettings(raw) : null;
}

export function parseBotTestSettings(raw: string): BotTestSettings | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawBots: Record<string, unknown>[] = Array.isArray(parsed.bots)
      ? (parsed.bots as Record<string, unknown>[])
      : parsed.workflowBaseUrl
        ? [{ ...parsed, id: "default", name: DEFAULT_BOT_PROFILE.name }]
        : [];
    const bots: BotProfile[] = rawBots
      .map((b, i) => ({
        id: str(b.id) || `bot-${i + 1}`,
        name: str(b.name) || `機器人 ${i + 1}`,
        description: str(b.description),
        workflowBaseUrl: str(b.workflowBaseUrl),
        gatewayBaseUrl: str(b.gatewayBaseUrl),
        platformId: str(b.platformId),
      }))
      .filter((b) => b.workflowBaseUrl && b.gatewayBaseUrl && b.platformId);
    // 舊資料：知識庫 platformId 可能在最上層，或在第一隻機器人裡
    const knowledgePlatformId = str(parsed.knowledgePlatformId) || str(rawBots[0]?.knowledgePlatformId);
    return {
      bots,
      knowledgePlatformId,
      uploadPath: str(parsed.uploadPath) || DEFAULT_UPLOAD_PATH,
      knowledgePath: str(parsed.knowledgePath) || DEFAULT_KNOWLEDGE_PATH,
      tokenUrl: str(parsed.tokenUrl),
      clientId: str(parsed.clientId),
      clientSecret: str(parsed.clientSecret),
      tokenCompanyId: str(parsed.tokenCompanyId),
      tokenCompanyCode: str(parsed.tokenCompanyCode),
    };
  } catch {
    return null;
  }
}

export function toTarget(settings: BotTestSettings, bot: BotProfile): BotTestTarget {
  const { bots: _bots, ...shared } = settings;
  void _bots;
  return {
    ...shared,
    botId: bot.id,
    botName: bot.name,
    workflowBaseUrl: bot.workflowBaseUrl,
    gatewayBaseUrl: bot.gatewayBaseUrl,
    platformId: bot.platformId,
  };
}

// 取得要呼叫的機器人；沒指定（或指定的已被刪除）時用第一隻
export async function getBotTestTarget(companyId: string, botId?: string | null): Promise<BotTestTarget | null> {
  const settings = await getBotTestSettings(companyId);
  if (!settings || settings.bots.length === 0) return null;
  const bot = settings.bots.find((b) => b.id === botId) ?? settings.bots[0];
  return toTarget(settings, bot);
}

// 指定的機器人一定要存在（例如自動優化任務、部署到後台），不自動換成別隻
export async function getBotTestTargetStrict(companyId: string, botId: string | null | undefined): Promise<BotTestTarget | null> {
  const settings = await getBotTestSettings(companyId);
  const bot = settings?.bots.find((b) => b.id === botId) ?? (botId ? undefined : settings?.bots[0]);
  return settings && bot ? toTarget(settings, bot) : null;
}

export async function getBotOptions(companyId: string): Promise<BotOption[]> {
  const settings = await getBotTestSettings(companyId);
  return (settings?.bots ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    channel: b.platformId,
  }));
}

export class BotTokenError extends Error {}

type TokenClaims = {
  tenantId: string;
  corporationId: string;
  companyId: string;
  companyCode: string;
};

// 讀 token 裡的公司資訊，不檢查過期也不丟錯（自動續期時從上一支 access token 帶出 companyId／company_code）
export function readTokenCompany(token: string): { companyId: string; companyCode: string } | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const companyId = String(payload.company ?? "");
    const companyCode = String(payload.company_code ?? "");
    return companyId && companyCode ? { companyId, companyCode } : null;
  } catch {
    return null;
  }
}

// token 的到期時間（毫秒）；讀不到就回傳 null。自動優化用它在 token 快過期前先暫停。
export function tokenExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    const exp = Number(payload.exp);
    return exp ? exp * 1000 : null;
  } catch {
    return null;
  }
}

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
