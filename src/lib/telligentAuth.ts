import { BotTokenError, decodeTokenClaims, type BotTestTarget } from "@/lib/botTest";

// telligent 的 token 換發（OpenIddict refresh_token grant）：使用者貼 refresh token，系統自己換 access token。
// refresh token 每換一次就會換新的一支（舊的失效），所以呼叫端要保存回傳的新 refresh token；全程只放記憶體。

export type TokenCredentials = { accessToken: string; refreshToken: string | null };

// access token 是 3 段的 JWT；refresh token 是加密過的 JWE（5 段）
export function isRefreshToken(token: string): boolean {
  return token.split(".").length === 5;
}

// 貼上時常會帶到前後引號、換行或空白（例如從 JSON 回應複製），一併清掉
export function cleanTokenInput(raw: string): string {
  return raw
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, "");
}

export function canRefreshToken(target: BotTestTarget): boolean {
  return Boolean(target.clientId && target.clientSecret);
}

function tokenEndpoint(target: BotTestTarget): string {
  return target.tokenUrl || `${target.workflowBaseUrl}/oauth2api/connect/token`;
}

function maskSecrets(message: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((m, s) => m.split(s).join("***"), message);
}

export async function refreshAccessToken(target: BotTestTarget, refreshToken: string): Promise<TokenCredentials> {
  if (!canRefreshToken(target)) throw new BotTokenError("這間公司還沒設定自動換 token（client_id／client_secret），請改貼 access token。");
  const res = await fetch(tokenEndpoint(target), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: target.clientId,
      client_secret: target.clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: { access_token?: string; refresh_token?: string; error?: string; error_description?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON 回應，下面統一當失敗處理
  }
  if (!res.ok || !json.access_token) {
    const reason = json.error_description || json.error || text.replace(/\s+/g, " ").slice(0, 200) || "沒有回應內容";
    const detail = maskSecrets(`HTTP ${res.status}：${reason}`, [target.clientSecret, refreshToken]);
    if (json.error === "invalid_client") throw new Error(`換 token 失敗：client_id／client_secret 不正確（${detail}）`);
    throw new BotTokenError(
      `refresh token 換不到新的 access token（${detail}）。每支 refresh token 只能用一次：如果這支之前貼過（包括伺服器重新啟動前），請重新登入取得新的一支；也請確認有完整複製。`,
    );
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? refreshToken };
}

// 使用者貼的 token：access token 直接用；refresh token 先換一支 access token（順便驗證可以用）
export async function resolveTokenInput(target: BotTestTarget, raw: string): Promise<TokenCredentials> {
  const token = cleanTokenInput(raw);
  if (!token) throw new BotTokenError("請填 token。");
  const creds = isRefreshToken(token) ? await refreshAccessToken(target, token) : { accessToken: token, refreshToken: null };
  decodeTokenClaims(creds.accessToken);
  return creds;
}
