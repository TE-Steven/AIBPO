import { createHmac, timingSafeEqual } from "node:crypto";
import { getSystemSetting, setSystemSetting } from "@/lib/systemSettings";

// LINE 群組通知（LINE 官方帳號 Messaging API），每間公司用自己的 LINE 機器人：
// - Channel secret／access token 由公司管理員在「參數管理 → LINE 通知」填寫，存在公司設定（不會再傳回瀏覽器）
// - LINE 後台的 webhook 設成 /api/line/webhook/{companyId}，用這間公司的 channel secret 驗證簽章
// - 把機器人拉進群組，在群組傳綁定碼，就把群組綁到這間公司；自動優化完成、失敗、暫停、停止時推播到綁定的群組

const LINE_API = "https://api.line.me/v2/bot";
export const LINE_NOTIFY_KEY = "line_notify";

export type LineGroup = { groupId: string; name: string | null; boundAt: string };
type LineSettings = { channelSecret: string; accessToken: string; groups: LineGroup[] };

export async function getLineSettings(companyId: string): Promise<LineSettings> {
  try {
    const raw = JSON.parse((await getSystemSetting(companyId, LINE_NOTIFY_KEY)) || "{}") as Partial<LineSettings>;
    return {
      channelSecret: typeof raw.channelSecret === "string" ? raw.channelSecret : "",
      accessToken: typeof raw.accessToken === "string" ? raw.accessToken : "",
      groups: Array.isArray(raw.groups) ? raw.groups.filter((g) => typeof g?.groupId === "string") : [],
    };
  } catch {
    return { channelSecret: "", accessToken: "", groups: [] };
  }
}

async function saveLineSettings(companyId: string, settings: LineSettings): Promise<void> {
  await setSystemSetting(companyId, LINE_NOTIFY_KEY, JSON.stringify(settings));
}

// 留空的欄位維持原本的值（畫面不會顯示已存的金鑰）
export async function saveLineCredentials(companyId: string, input: { channelSecret?: string; accessToken?: string }): Promise<void> {
  const current = await getLineSettings(companyId);
  await saveLineSettings(companyId, {
    ...current,
    channelSecret: input.channelSecret?.trim() || current.channelSecret,
    accessToken: input.accessToken?.trim() || current.accessToken,
  });
}

export function isLineConfigured(settings: Pick<LineSettings, "channelSecret" | "accessToken">): boolean {
  return Boolean(settings.channelSecret && settings.accessToken);
}

// 驗證 webhook 真的是 LINE 送來的：x-line-signature＝用 channel secret 對原始 body 做 HMAC-SHA256 再 base64
export function verifyLineSignature(channelSecret: string, body: string, signature: string | null): boolean {
  if (!channelSecret || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", channelSecret).update(body).digest("base64"));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// 公司的綁定碼：由公司 id 算出來（不用另外存）。在群組傳這組碼才會綁定，避免機器人被拉進任何群組就收到通知
export function lineBindingCode(companyId: string): string {
  const digest = createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`line-binding:${companyId}`).digest();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `AIBPO-${Array.from(digest.subarray(0, 6), (b) => alphabet[b % alphabet.length]).join("")}`;
}

export function lineWebhookPath(companyId: string): string {
  return `/api/line/webhook/${companyId}`;
}

export async function addLineGroup(companyId: string, groupId: string, name: string | null): Promise<void> {
  const settings = await getLineSettings(companyId);
  const groups = settings.groups.filter((g) => g.groupId !== groupId);
  groups.push({ groupId, name, boundAt: new Date().toISOString() });
  await saveLineSettings(companyId, { ...settings, groups });
}

export async function removeLineGroup(companyId: string, groupId: string): Promise<boolean> {
  const settings = await getLineSettings(companyId);
  if (!settings.groups.some((g) => g.groupId === groupId)) return false;
  await saveLineSettings(companyId, { ...settings, groups: settings.groups.filter((g) => g.groupId !== groupId) });
  return true;
}

async function lineApi(token: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${LINE_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function lineGroupName(token: string, groupId: string): Promise<string | null> {
  try {
    const res = await lineApi(token, `/group/${encodeURIComponent(groupId)}/summary`);
    return res.ok ? (((await res.json()) as { groupName?: string }).groupName ?? null) : null;
  } catch {
    return null;
  }
}

// 回覆 webhook 收到的訊息（回覆不算推播則數）
export async function lineReply(token: string, replyToken: string, text: string): Promise<void> {
  await lineApi(token, "/message/reply", { replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }).catch(() => null);
}

async function linePush(token: string, to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await lineApi(token, "/message/push", { to, messages: [{ type: "text", text: text.slice(0, 4900) }] });
    if (res.ok) return { ok: true };
    const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message;
    return { ok: false, error: `LINE 回應 HTTP ${res.status}${detail ? `：${detail}` : ""}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "連線失敗" };
  }
}

// 推播給這間公司綁定的所有群組；失敗只記 log，不影響呼叫端
export async function notifyCompany(companyId: string, text: string): Promise<{ sent: number; errors: string[] }> {
  const settings = await getLineSettings(companyId);
  if (!isLineConfigured(settings)) return { sent: 0, errors: [] };
  let sent = 0;
  const errors: string[] = [];
  for (const g of settings.groups) {
    const r = await linePush(settings.accessToken, g.groupId, text);
    if (r.ok) sent++;
    else errors.push(`${g.name ?? "LINE 群組"}：${r.error}`);
  }
  if (errors.length > 0) console.error("LINE notify failed", errors);
  return { sent, errors };
}

// 站台網址（通知裡附連結用）：APP_BASE_URL，或 Render 自動提供的 RENDER_EXTERNAL_URL
export function appBaseUrl(): string | null {
  return (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "") || null;
}
