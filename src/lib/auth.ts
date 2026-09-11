import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "aibpo_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 小時

export const SUPER_ADMIN_SUBJECT = "SUPERADMIN";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/** 簽發 session token：payload 內含使用者 id（或 SUPERADMIN）與到期時間，HMAC 簽章防竄改。 */
export function createSessionToken(subject: string): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${subject}.${expiresAt}`;
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

/** 驗證 token 簽章與到期時間，成功則回傳 subject（使用者 id 或 SUPERADMIN）。 */
export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;

  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  const [subject, expiresAtRaw] = payload.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!subject || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return subject;
}

/**
 * 超級管理員帳密只放在環境變數（Render 的服務參數），不落地在資料庫，
 * 因此不能被一般帳號管理功能查到或改到。
 */
export function verifySuperAdminCredentials(username: string, password: string): boolean {
  const validUsername = process.env.SUPER_ADMIN_USERNAME;
  const validPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (!validUsername || !validPassword) return false;
  return username === validUsername && password === validPassword;
}
