import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// 自動化管理：Worker 會照登記的網址開網頁，必須擋掉內部網址（localhost、內網、雲端主機資訊端點等），
// 避免被拿來存取伺服器所在的內部網路（SSRF）。登記時、Worker 開頁面前、頁面裡的每個請求都檢查。

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6Private(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? ipv4Private(mapped[1]) : false;
}

export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  return kind === 4 ? ipv4Private(ip) : kind === 6 ? ipv6Private(ip) : true;
}

function blockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".");
}

const cache = new Map<string, { ok: boolean; at: number }>();

// 主機名稱是否指向公開網路（DNS 解析後所有位址都不能是內部位址）；結果快取 5 分鐘
export async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const cached = cache.get(host);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.ok;
  let ok: boolean;
  if (isIP(host)) ok = !isPrivateIp(host);
  else if (blockedHostname(host)) ok = false;
  else {
    try {
      const addrs = await lookup(host, { all: true });
      ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
    } catch {
      ok = false;
    }
  }
  cache.set(host, { ok, at: Date.now() });
  return ok;
}

// 檢查登記的表單網址：只接受 http(s)、公開網路；回傳正規化後的網址或錯誤訊息
export async function checkFormUrl(raw: string): Promise<{ url: string; domain: string } | { error: string }> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: "網址格式不正確。" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "只支援 http:// 或 https:// 開頭的網址。" };
  if (u.username || u.password) return { error: "網址不能包含帳號密碼。" };
  if (!(await isPublicHost(u.hostname))) return { error: "這個網址指向內部網路或無法解析，不能登記。" };
  return { url: u.toString(), domain: u.hostname.toLowerCase() };
}
