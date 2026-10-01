import { decodeTokenClaims, BotTokenError, type BotTestTarget } from "@/lib/botTest";

// telligent 後台知識庫（生成式知識）API：上傳 md → 新增知識 → 學習 → 刪除。
// 自動優化每一輪用這些 API 把版本放進後台；AIBPO 只會刪除自己上傳時記下的知識 id。

const REQUEST_TIMEOUT_MS = 60_000;

export type KnowledgeItem = {
  id: string;
  name: string;
  sourceName: string | null;
  status: number;
  lastTrainingTime: string | null;
  creationTime: string | null;
  operationType: number;
};

// AIBPO 上傳的知識名稱一律用這個開頭，查詢時用它當關鍵字（後台知識很多時，不帶關鍵字的第一頁可能找不到）
export const AIBPO_KNOWLEDGE_PREFIX = "AIBPO-";

export class KnowledgeApiError extends Error {}

function maskToken(message: string, token: string): string {
  return token ? message.split(token).join("***") : message;
}

function resolvePath(target: BotTestTarget, token: string, path: string): string {
  const { companyCode } = decodeTokenClaims(token);
  return `${target.gatewayBaseUrl}${path.replace("{code}", encodeURIComponent(companyCode))}`;
}

// label：哪一支 API（錯誤訊息用）。失敗時訊息帶上方法與路徑（不含 token），方便對照後台 log。
async function request(url: string, token: string, init: RequestInit, label: string): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new BotTokenError("token 無效或已過期，請換一個新的 token。");
  const text = await res.text();
  if (!res.ok) {
    const { pathname, search } = new URL(url);
    const detail = text.trim() ? text.slice(0, 300) : "（沒有回應內容）";
    const sent = typeof init.body === "string" ? `｜送出 ${init.body.slice(0, 300)}` : "";
    throw new KnowledgeApiError(
      maskToken(`知識庫 API（${label}）回應 HTTP ${res.status}：${detail}｜${init.method ?? "GET"} ${pathname}${search}${sent}`, token),
    );
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

// 上傳 md 到雲端，回傳檔案網址
export async function uploadMarkdown(target: BotTestTarget, token: string, markdown: string, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([markdown], { type: "text/markdown" }), fileName);
  const json = (await request(resolvePath(target, token, target.uploadPath), token, { method: "POST", body: form }, "上傳檔案")) as {
    success?: boolean;
    url?: string;
    message?: string | null;
  };
  if (!json.url) throw new KnowledgeApiError(`上傳檔案失敗：${json.message ?? "沒有回傳檔案網址"}`);
  return json.url;
}

// 新增一筆生成式知識（type 4 = 檔案網址），回傳知識 id。實測新增 API 只回 true，所以用唯一名稱查回 id。
export async function createKnowledge(
  target: BotTestTarget,
  token: string,
  input: { name: string; url: string; sourceName: string },
): Promise<string> {
  const json = (await request(resolvePath(target, token, target.knowledgePath), token, {
    method: "POST",
    body: JSON.stringify({
      platformId: target.knowledgePlatformId,
      type: 4,
      name: input.name,
      source: input.url,
      sourceName: input.sourceName,
      depth: 0,
      quantityUpper: 0,
      extensionSources: [],
      sourceUrlQueryString: [],
    }),
  }, "新增知識")) as { id?: string; data?: { id?: string } };
  const directId = json?.id ?? json?.data?.id;
  if (typeof directId === "string" && directId) return directId;

  const found = await findKnowledgeByName(target, token, input.name);
  if (!found) throw new KnowledgeApiError(`新增知識後找不到「${input.name}」，請確認知識庫 platformId 是否正確。`);
  return found.id;
}

// 關鍵字查詢（實測是部分比對），會把每一頁都撈完
export async function listKnowledge(target: BotTestTarget, token: string, keyword: string): Promise<KnowledgeItem[]> {
  const all: KnowledgeItem[] = [];
  for (let page = 1; page <= 20; page++) {
    const params = new URLSearchParams({ platformId: target.knowledgePlatformId, keyword, page: String(page), limit: "50" });
    const json = (await request(`${resolvePath(target, token, target.knowledgePath)}/list?${params}`, token, { method: "GET" }, "查詢知識列表")) as {
      items?: Partial<KnowledgeItem>[];
      totalPages?: number;
    };
    for (const i of json.items ?? []) {
      if (typeof i.id !== "string") continue;
      all.push({
        id: i.id,
        name: i.name ?? "",
        sourceName: i.sourceName ?? null,
        status: Number(i.status ?? -1),
        lastTrainingTime: i.lastTrainingTime ?? null,
        creationTime: i.creationTime ?? null,
        operationType: Number(i.operationType ?? 0),
      });
    }
    if (!json.totalPages || page >= json.totalPages) break;
  }
  return all;
}

export async function getAibpoKnowledge(target: BotTestTarget, token: string, id: string): Promise<KnowledgeItem | null> {
  return (await listKnowledge(target, token, AIBPO_KNOWLEDGE_PREFIX)).find((i) => i.id === id) ?? null;
}

export async function findKnowledgeByName(target: BotTestTarget, token: string, name: string): Promise<KnowledgeItem | null> {
  const items = await listKnowledge(target, token, name);
  return items.find((i) => i.name === name) ?? null;
}

// 回傳 { learnableCount, ignoredCount }：已經在學習中的會被忽略
export async function learnKnowledge(target: BotTestTarget, token: string, ids: string[]): Promise<void> {
  await request(`${resolvePath(target, token, target.knowledgePath)}/learn`, token, { method: "POST", body: JSON.stringify({ ids }) }, "送出學習");
}

// 刪除是非同步的：送出後狀態先變 3（operationType 1），過一陣子才從列表消失
export async function deleteKnowledge(target: BotTestTarget, token: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await request(`${resolvePath(target, token, target.knowledgePath)}/delete`, token, { method: "POST", body: JSON.stringify({ ids }) }, "刪除知識");
}

// 等刪除完成（從列表消失），避免舊知識還在影響下一輪的測試；逾時就不再等（已標成刪除中）
export async function waitUntilDeleted(target: BotTestTarget, token: string, ids: string[], timeoutMs = 5 * 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = (await listKnowledge(target, token, AIBPO_KNOWLEDGE_PREFIX)).filter((i) => ids.includes(i.id));
    if (remaining.length === 0) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

// 實測狀態碼：0＝新增未學習、1＝學習中、2＝已學習（有 lastTrainingTime）、3＝刪除中（operationType 1）
export const LEARNED_STATUSES = new Set([2]);
export const DELETING_STATUS = 3;

// 自動優化每一輪都是新上傳的知識，所以只要有 lastTrainingTime 就一定是這一輪學的，不用比對時間
export function isLearned(item: KnowledgeItem): boolean {
  return LEARNED_STATUSES.has(item.status) && Boolean(item.lastTrainingTime);
}

// 輪詢直到學習完成；shouldStop 讓呼叫端在使用者按停止時中斷等待
// 等一批知識全部學習完成（結構化文件一份一個檔，會有很多筆）；onProgress 回報完成幾筆
export async function waitUntilAllLearned(
  target: BotTestTarget,
  token: string,
  ids: string[],
  options: { timeoutMs?: number; intervalMs?: number; shouldStop?: () => Promise<boolean>; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? (20 + ids.length) * 60_000);
  for (;;) {
    const items = new Map((await listKnowledge(target, token, AIBPO_KNOWLEDGE_PREFIX)).map((i) => [i.id, i]));
    const missing = ids.filter((id) => {
      const item = items.get(id);
      return !item || item.status === DELETING_STATUS;
    });
    if (missing.length > 0) throw new KnowledgeApiError(`後台找不到 ${missing.length} 筆剛新增的知識，可能已被刪除。`);
    const done = ids.filter((id) => isLearned(items.get(id)!)).length;
    options.onProgress?.(done, ids.length);
    if (done === ids.length) return;
    if (Date.now() > deadline) throw new KnowledgeApiError(`等學習完成超過時間（完成 ${done}／${ids.length} 筆）。`);
    if (await options.shouldStop?.()) throw new KnowledgeApiError("已停止。");
    await new Promise((r) => setTimeout(r, options.intervalMs ?? 15_000));
  }
}
