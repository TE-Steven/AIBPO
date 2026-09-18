export type SkillDraftHeader = { key: string; value: string };
export type SkillDraftParam = { name: string; type: string; description: string; required: boolean };

export type SkillDraftFields = {
  name: string | null;
  description: string | null;
  method: string | null;
  urlTemplate: string | null;
  authType: string | null;
  authConfig: Record<string, string> | null;
  headers: SkillDraftHeader[];
  paramsSchema: SkillDraftParam[];
};

const EMPTY_DRAFT: SkillDraftFields = {
  name: null,
  description: null,
  method: null,
  urlTemplate: null,
  authType: null,
  authConfig: null,
  headers: [],
  paramsSchema: [],
};

const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const VALID_AUTH_TYPES = ["NONE", "BEARER", "API_KEY_HEADER", "BASIC"];
const VALID_PARAM_TYPES = ["string", "number", "boolean", "array"];

export function buildSkillDraftSystemPrompt(): string {
  return `你是「Skill 設定助手」。使用者要透過口語化對話，設定一個可以被 AI Agent 呼叫的 API 工具（Skill）。請全程使用繁體中文對話。

使用者可能用很口語、片段的方式描述，也可能直接貼一段 curl 指令或 API 文件片段。你的任務是透過對話，把以下欄位盡量填滿：
- name：Skill 的名稱
- description：用途說明（之後會給 AI 判斷何時該呼叫這個 Skill，要寫清楚）
- method：GET / POST / PUT / PATCH / DELETE 其中一種
- urlTemplate：完整 URL，如果網址裡有會變動的部分（例如型號、訂單編號），要改寫成 {{參數名稱}} 這種佔位符
- authType：NONE（無）/ BEARER（Bearer Token）/ API_KEY_HEADER（自訂 Header 帶金鑰）/ BASIC（帳密）其中一種，以及對應的 authConfig
- headers：除了認證以外，其他固定要帶的 Header（陣列，每個是 {key, value}）
- paramsSchema：AI 呼叫這個 Skill 時需要提供的參數清單（陣列，每個是 {name, type, description, required}，type 只能是 string/number/boolean/array 其中一種），這些參數名稱要跟 urlTemplate 裡的 {{參數名稱}} 對應

規則：
- 一次只問最關鍵的 1-2 個缺口，不要一次列一堆問題轟炸使用者
- 如果使用者一次講了很多資訊（例如貼了 curl 指令），盡量一次全部解析出來，不要明明看得出來還硬要多問
- **絕對不要自己發明你不知道的資訊**（網址、金鑰、host 等）——不確定就留 null，繼續問使用者，不能用看起來合理的假資料填空
- 如果使用者的描述已經足夠讓你判斷某個欄位，即使使用者沒有明講，你也可以合理推論並在回覆裡跟使用者確認（例如「查詢」類的通常是 GET，我先幫你填 GET，如果不對請告訴我）

**每一次回覆**都要包含兩部分：
1. 給使用者看的口語回覆（確認目前進度、問下一個問題）
2. 回覆的最後面，輸出一個 \`\`\`json 區塊（只能有這一個），代表**目前為止累積的完整設定**（不是只有這一輪新增的，是包含之前所有輪次已經確定的全部欄位），格式如下，不知道的欄位填 null，陣列類欄位不知道就填空陣列：

\`\`\`json
{"name": "...或null", "description": "...或null", "method": "...或null", "urlTemplate": "...或null", "authType": "...或null", "authConfig": {}或null, "headers": [{"key":"...","value":"..."}], "paramsSchema": [{"name":"...","type":"string","description":"...","required":true}]}
\`\`\``;
}

export function parseSkillDraftReply(text: string): { reply: string; draft: SkillDraftFields } {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  const reply = (match ? text.slice(0, match.index) : text).trim();

  if (!match) return { reply, draft: EMPTY_DRAFT };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { reply, draft: EMPTY_DRAFT };
  }

  if (typeof parsed !== "object" || parsed === null) return { reply, draft: EMPTY_DRAFT };
  const obj = parsed as Record<string, unknown>;

  const method = typeof obj.method === "string" && VALID_METHODS.includes(obj.method.toUpperCase()) ? obj.method.toUpperCase() : null;
  const authType =
    typeof obj.authType === "string" && VALID_AUTH_TYPES.includes(obj.authType.toUpperCase()) ? obj.authType.toUpperCase() : null;

  const headers = Array.isArray(obj.headers)
    ? obj.headers
        .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null && typeof h.key === "string")
        .map((h) => ({ key: String(h.key).trim(), value: String(h.value ?? "") }))
        .filter((h) => h.key.length > 0)
    : [];

  const paramsSchema = Array.isArray(obj.paramsSchema)
    ? obj.paramsSchema
        .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null && typeof p.name === "string")
        .map((p) => ({
          name: String(p.name).trim(),
          type: typeof p.type === "string" && VALID_PARAM_TYPES.includes(p.type) ? p.type : "string",
          description: String(p.description ?? ""),
          required: Boolean(p.required),
        }))
        .filter((p) => p.name.length > 0)
    : [];

  const draft: SkillDraftFields = {
    name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : null,
    description: typeof obj.description === "string" && obj.description.trim() ? obj.description.trim() : null,
    method,
    urlTemplate: typeof obj.urlTemplate === "string" && obj.urlTemplate.trim() ? obj.urlTemplate.trim() : null,
    authType,
    authConfig: typeof obj.authConfig === "object" && obj.authConfig !== null ? (obj.authConfig as Record<string, string>) : null,
    headers,
    paramsSchema,
  };

  return { reply, draft };
}
