import type Anthropic from "@anthropic-ai/sdk";
import type { KmEntry, KmSource, Tally } from "@/generated/prisma/client";
import type { TallyNode } from "@/lib/tallyTree";
import { ruleText, resolveOptions, type PromptConfigData } from "@/lib/promptConfig";

export type FaqDraft = { question: string; answer: string; suggestedTally: string | null };
// 依分類範本整理的結構化文件（AI 原始輸出）：template = 第一層分類名稱，values 的 key 是「維度」或「維度 > 子維度」
export type TallyDocumentDraft = { template: string; name: string; values: Record<string, string | null> };
// 關聯：同一筆關聯只列一次（items 是兩個以上的實體名稱），程式會雙向寫進每個相關實體的「相關項目」段
export type TallyRelationDraft = { items: string[]; description: string };
export type SharedRule = { field: string | null; text: string };
export type TallyOutputDraft = {
  documents: TallyDocumentDraft[];
  // 範本名稱 → 適用這個範本「所有」實體的通用規則；field 是規則對應的欄位（沒有對應欄位為 null）
  sharedRules: Map<string, SharedRule[]>;
  relations: TallyRelationDraft[];
};
export type TallyTemplate = TallyNode<Tally>;

function guidelinesPrefix(guidelines?: string): string {
  return guidelines?.trim() ? `【最高準則，優先於本提示詞裡的其他任何指示，一定要遵守】\n${guidelines.trim()}\n\n---\n\n` : "";
}

export type WorkflowDraft = {
  suggestedName: string;
  suggestedPrompt: string;
  suggestedSkillIds: string[];
  unmatchedNote: string | null;
};

// 把一段規則清單組成「- 規則」的條列；全部關閉時回傳 null
function ruleLines(config: PromptConfigData | undefined, ids: string[]): string | null {
  const lines = ids.map((id) => ruleText(config, id)).filter((t): t is string => Boolean(t));
  return lines.length > 0 ? lines.map((t) => `- ${t}`).join("\n") : null;
}

// FAQ 分析的提示詞。結構化文件另外用 buildDocumentsSystemPrompt 分開產生（兩者一起輸出時太長容易被截斷、互相拖累）。
// 文字與開關來自公司的提示詞設定（參數管理），沒設定的部分用預設。
export function buildSystemPrompt(params: {
  dimensions: string[];
  // 分類的完整路徑（大 > 中 > 小），讓 AI 替每題 FAQ 建議歸類
  tallyPaths: string[];
  countMin: number;
  countMax: number;
  answerStyle?: string;
  guidelines?: string;
  config?: PromptConfigData;
}): string {
  const { dimensions, tallyPaths, countMin, countMax, answerStyle, guidelines, config } = params;

  const dimensionsText =
    dimensions.length > 0
      ? dimensions.map((d) => `- ${d}`).join("\n")
      : "（使用者沒有指定特定維度，請你自行判斷內容中最值得整理成 FAQ 的重點）";

  const tallyText =
    tallyPaths.length > 0 ? `\n${ruleText(config, "F10")}\n${tallyPaths.map((t) => `- ${t}`).join("\n")}\n` : "";

  const answerStyleText = answerStyle?.trim()
    ? `\n使用者對「答案」的輸出風格有以下額外要求，請務必遵守：\n${answerStyle.trim()}\n`
    : "";

  const rules = ruleLines(config, ["F1", "F2", "F3", "F4", "F5", "F6"]);
  const countText = rules
    ? `請產出介於 ${countMin} 到 ${countMax} 題之間的 FAQ，每一題必須：\n${rules}`
    : `請產出介於 ${countMin} 到 ${countMax} 題之間的 FAQ。`;

  return `${guidelinesPrefix(guidelines)}${ruleText(config, "faq.intro")}

${ruleText(config, "faq.language")}

分析維度：
${dimensionsText}
${tallyText}${answerStyleText}
${countText}

完成你的分析與思考後，在回應的最後面，輸出一個 \`\`\`json 區塊（只能有這一個 json 區塊），內容是一個陣列，格式如下，不要在 json 區塊內加註解或其他文字：

\`\`\`json
[{"question": "...", "answer": "...", "suggestedTally": "分類完整路徑或 null"}]
\`\`\``;
}

// 範本欄位：第二層維度；有第三層的話再列出「維度 > 子維度」（withOverview：有子維度的維度另外提供「補充說明」欄位）
// description：分類管理填的描述（選填），放在欄位後面的「（說明：…）」讓 AI 知道這個欄位該放什麼
function templateFields(
  template: TallyTemplate,
  withOverview: boolean,
): { key: string; optional: boolean; description: string | null }[] {
  const desc = (d?: string | null) => d?.trim().replace(/\s+/g, " ") || null;
  return template.children.flatMap((h2) =>
    h2.children.length > 0
      ? [
          ...(withOverview ? [{ key: h2.name, optional: true, description: desc(h2.description) }] : []),
          ...h2.children.map((h3) => ({
            key: `${h2.name} > ${h3.name}`,
            optional: false,
            // 沒有補充說明欄位時，把上層維度的說明併到子欄位，避免遺失
            description:
              [desc(h3.description), !withOverview && desc(h2.description) ? `上層「${h2.name}」：${desc(h2.description)}` : null]
                .filter(Boolean)
                .join("；") || null,
          })),
        ]
      : [{ key: h2.name, optional: false, description: desc(h2.description) }],
  );
}

// 結構化文件的提示詞：只做「找出所有實體、逐欄填寫」，不受 FAQ 的分析維度、題數、答案風格影響（最高準則仍然適用）。
export function buildDocumentsSystemPrompt(params: {
  templates: TallyTemplate[];
  guidelines?: string;
  config?: PromptConfigData;
}): string {
  const { config } = params;
  const options = resolveOptions(config);
  const templatesText = params.templates
    .map(
      (t) =>
        `範本「${t.name}」${t.description?.trim() ? `（說明：${t.description.trim().replace(/\s+/g, " ")}）` : ""}的欄位：\n${templateFields(
          t,
          options.docOverviewField,
        )
          .map(
            (f) =>
              `- ${f.key}${f.description ? `（說明：${f.description}）` : ""}${f.optional ? "（補充說明：只寫放不進下面任何子欄位的資訊，沒有就填 null）" : ""}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");

  const withShared = Boolean(ruleText(config, "D11"));
  const withRelations = Boolean(ruleText(config, "D14"));
  const blocks = [
    `${guidelinesPrefix(params.guidelines)}${ruleText(config, "doc.intro")}`,
    ruleText(config, "doc.language"),
    ruleText(config, "doc.task"),
    templatesText,
    `規則：\n${ruleLines(config, ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D17", "D18", "D19", "D20", "D21", "D10"])}`,
    withShared ? `通用規則（sharedRules）：\n${ruleLines(config, ["D11", "D12", "D13"])}` : null,
    withRelations ? `關聯（relations）：\n${ruleLines(config, ["D14", "D15", "D16"])}` : null,
  ];

  const emptyNote =
    withShared && withRelations ? "；沒有通用規則或關聯時，給空陣列" : withShared ? "；沒有通用規則時，給空陣列" : withRelations ? "；沒有關聯時，給空陣列" : "";
  const format = `{"documents": [{"template": "範本名稱", "name": "實體名稱", "values": {"欄位名稱": "內容或 null"}}]${
    withShared ? `, "sharedRules": [{"template": "範本名稱", "rules": [{"field": "欄位名稱或 null", "text": "規則"}]}]` : ""
  }${withRelations ? `, "relations": [{"items": ["實體名稱A", "實體名稱B"], "description": "關係說明"}]` : ""}}`;
  blocks.push(
    `完成你的分析與思考後，在回應的最後面，輸出一個 \`\`\`json 區塊（只能有這一個 json 區塊），格式如下，不要在 json 區塊內加註解或其他文字${emptyNote}：\n\n\`\`\`json\n${format}\n\`\`\``,
  );

  return blocks.filter((b): b is string => Boolean(b)).join("\n\n");
}

// 機器人測試 AI 比對的提示詞（參數管理「機器人測試」分頁）：
// 1. 把標準答案拆成關鍵答案（K 系列，每個標準答案只拆一次）
export function buildKeyPointsSystemPrompt(config?: PromptConfigData): string {
  return `${ruleText(config, "kp.intro")}\n${ruleLines(config, ["K1", "K2", "K3", "K4"])}`;
}

// 2. 逐點檢查機器人回答（P 系列）；最後是否一致由系統依比對規則計算，不交給 AI
export function buildJudgeSystemPrompt(config?: PromptConfigData): string {
  return `${ruleText(config, "jp.intro")}\n${ruleLines(config, ["P1", "P2", "P3", "P4"])}`;
}

export type SourceFileRef = { fileId: string; fileName: string };

/** 多檔案優先讀新欄位 sourceFileIds；沒有就退回舊資料的單一 sourceFileId，維持舊來源可用。 */
export function getSourceFiles(source: KmSource): SourceFileRef[] {
  if (Array.isArray(source.sourceFileIds) && source.sourceFileIds.length > 0) {
    return source.sourceFileIds as unknown as SourceFileRef[];
  }
  if (source.sourceFileId) {
    return [{ fileId: source.sourceFileId, fileName: source.sourceName ?? "文件" }];
  }
  return [];
}

/** 多網址優先讀新欄位 sourceUrls；沒有就退回舊資料的單一 sourceUrl。 */
export function getSourceUrls(source: KmSource): string[] {
  if (Array.isArray(source.sourceUrls) && source.sourceUrls.length > 0) {
    return source.sourceUrls as unknown as string[];
  }
  if (source.sourceUrl) return [source.sourceUrl];
  return [];
}

/** 來源紀錄列表/詳情頁要顯示的簡短標籤，混合來源時檔案跟網址都會列出總數。 */
export function sourceLabel(source: KmSource): string {
  const files = getSourceFiles(source);
  const urls = getSourceUrls(source);
  const parts: string[] = [];
  if (files.length > 0) {
    parts.push(files.length === 1 ? files[0].fileName : `${files[0].fileName} 等 ${files.length} 個檔案`);
  }
  if (urls.length > 0) {
    parts.push(urls.length === 1 ? urls[0] : `${urls[0]} 等 ${urls.length} 個網址`);
  }
  return parts.length > 0 ? parts.join("　+　") : "—";
}

/** web_fetch 工具的 max_uses 要跟著網址數量走，避免多網址來源抓不完；沒有網址就不需要這個工具。 */
export function webFetchMaxUses(source: KmSource): number {
  return Math.max(3, getSourceUrls(source).length + 1);
}

/** 這個來源是否包含網址（混合來源也算），用來判斷要不要掛 web_fetch 工具。 */
export function hasSourceUrls(source: KmSource): boolean {
  return getSourceUrls(source).length > 0;
}

export function buildUserContent(source: KmSource, task: "faq" | "documents" = "faq"): Anthropic.MessageParam["content"] {
  const files = getSourceFiles(source);
  const urls = getSourceUrls(source);

  const documentBlocks = files.map((f) => ({
    type: "document" as const,
    source: { type: "file" as const, file_id: f.fileId },
  }));

  const instructions: string[] = [];
  if (files.length > 0) {
    instructions.push(
      files.length > 1 ? `以上附了 ${files.length} 份 PDF 文件` : "以上附了一份 PDF 文件",
    );
  }
  if (urls.length > 0) {
    instructions.push(
      urls.length > 1
        ? `請抓取並分析以下這幾個網址的內容：\n${urls.map((u) => `- ${u}`).join("\n")}`
        : `請抓取並分析這個網址的內容：${urls[0]}`,
    );
  }
  const output = task === "documents" ? "結構化文件" : "FAQ";
  instructions.push(
    files.length + urls.length > 1
      ? `以上這些請視為同一個知識來源合併分析，依照系統指示產出${output}。`
      : `請依照系統指示產出${output}。`,
  );

  return [...documentBlocks, { type: "text" as const, text: instructions.join("\n\n") }];
}

export function buildChatSystemPrompt(entries: Pick<KmEntry, "question" | "answer">[], guidelines?: string): string {
  const faqList = entries.map((e, i) => `${i + 1}. Q: ${e.question}\n   A: ${e.answer}`).join("\n");
  const guidelinesBlock = guidelines?.trim()
    ? `【最高準則，優先於以下任何指示，一定要遵守】\n${guidelines.trim()}\n\n---\n\n`
    : "";

  return `${guidelinesBlock}你是知識庫管理助手。請全程使用繁體中文思考與作答，包括你的思考過程也請用繁體中文書寫。使用者針對「這份來源文件」已經產出以下 FAQ 清單：

${faqList}

你可以做兩類事情：

1. **回答問題**：使用者可能問你關於這些題目的追問，例如「為什麼第3題會這樣回答」「這個答案的依據是文件哪一段」。你手上同時附有原始文件/網頁內容，請根據原始內容回答，解釋答案的依據。如果使用者問的內容在原始文件裡找不到根據，要誠實說明，不要虛構。

2. **執行操作**：使用者可能會下達指令式的要求，例如「幫我把所有提到 XXX 的地方改成 YYY」「幫我繼續新增10題關於活動的」「把所有關於價格的題目改歸到商品資訊分類」「刪掉所有關於舊活動的題目」。這種情況你要判斷該用哪個工具（find_replace_in_entries / generate_more_entries / reclassify_entries / delete_entries）去執行，不要只是用文字回答说你會做，要真的呼叫工具完成。執行完之後，用簡短的繁體中文告訴使用者做了什麼、影響了幾則、有哪些題目（列出前幾個當範例即可，不用全部列完）。如果工具回傳了 error，就照實告訴使用者原因並停止。`;
}

/** RAG 內容最上面的「文件資訊」區塊裡，doc_id/source 這兩個欄位是系統既有事實，不該讓 AI 用猜的。 */
export function ragDocId(source: KmSource): string {
  return source.id;
}

export function ragSourceDescription(source: KmSource): string {
  const hasFiles = getSourceFiles(source).length > 0;
  const hasUrls = getSourceUrls(source).length > 0;
  if (hasFiles && hasUrls) return "PDF 上傳 + 網址擷取";
  if (hasUrls) return "網址擷取";
  return "PDF 上傳";
}

export function buildRagSystemPrompt(params: {
  docId: string;
  sourceDescription: string;
  guidelines?: string;
  config?: PromptConfigData;
}): string {
  const { docId, sourceDescription, config } = params;

  // 開頭固定區塊：文件資訊（系統填入 doc_id／source）、本文回答哪些問題＋常見說法對照
  const docInfo = ruleText(config, "R1")?.replaceAll("{doc_id}", docId).replaceAll("{source}", sourceDescription) ?? null;
  const questions = ruleText(config, "R2");
  const questionsBlock = questions ? `${questions}${ruleText(config, "R3") ?? ""}` : null;
  const openingItems = [docInfo, questionsBlock].filter((t): t is string => Boolean(t));
  const opening =
    openingItems.length > 0
      ? `**開頭固定${openingItems.length === 2 ? "兩" : "一"}個區塊（在 H1 標題之後、正文之前）**\n\n${openingItems
          .map((t, i) => `${i + 1}. ${t}`)
          .join("\n\n")}`
      : null;

  const section = (title: string, ids: string[]) => {
    const lines = ruleLines(config, ids);
    return lines ? `**${title}**\n${lines}` : null;
  };

  const blocks = [
    `${guidelinesPrefix(params.guidelines)}${ruleText(config, "rag.intro")}`,
    ruleText(config, "R0"),
    opening,
    section("結構", ["R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11"]),
    section("內容要能被單獨切出來也看得懂（最關鍵的一條）", ["R12", "R13", "R14", "R15"]),
    section("表格", ["R16"]),
    ruleText(config, "R17"),
    ruleText(config, "R18"),
  ];
  return blocks.filter((b): b is string => Boolean(b)).join("\n\n");
}

export function buildWorkflowSystemPrompt(skills: { id: string; name: string; description: string }[]): string {
  const skillText =
    skills.length > 0
      ? skills.map((s) => `- ${s.name}：${s.description}`).join("\n")
      : "（目前沒有任何已建立的 Skill）";

  return `你是客服流程規劃助手。使用者會提供一份文件或一個網頁，請全程使用繁體中文思考與作答。

請仔細閱讀全文，找出文件中描述的所有「客服情境／流程」——同一份文件可能同時涵蓋多個不同情境（例如報修流程、保固查詢、退換貨），請盡量拆分成獨立的情境，不要合併成一個籠統的助手。

以下是目前系統裡已經存在的 Skill（可呼叫的工具）清單，每個情境只能從這份清單裡挑選匹配的 Skill（用「name」精確比對，一個情境可以選 0 到多個 Skill）：
${skillText}

如果某個情境完全沒有匹配的 Skill，不要自己發明新的 Skill 名稱，而是在 "unmatchedNote" 欄位裡用一句話說明「這個情境需要什麼樣的工具，但目前系統裡沒有」；如果都有匹配到，"unmatchedNote" 填 null。

針對每一個你找出的情境，輸出一組草稿：
- "suggestedName"：這個 Agent 的建議名稱
- "suggestedPrompt"：這個 Agent 的建議系統提示詞，用第一人稱定義它的角色與職責
- "matchedSkillNames"：從上面清單裡精確比對到的 Skill 名稱陣列
- "unmatchedNote"：說明或 null

完成你的分析與思考後，在回應的最後面，輸出一個 \`\`\`json 區塊（只能有這一個 json 區塊），內容是一個陣列，格式如下，不要在 json 區塊內加註解或其他文字：

\`\`\`json
[{"suggestedName": "...", "suggestedPrompt": "...", "matchedSkillNames": ["..."], "unmatchedNote": "說明或 null"}]
\`\`\``;
}

export function parseWorkflowDrafts(text: string, skills: { id: string; name: string }[]): WorkflowDraft[] {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  const jsonText = match ? match[1] : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const nameToId = new Map(skills.map((s) => [s.name, s.id]));

  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" &&
        item !== null &&
        typeof item.suggestedName === "string" &&
        typeof item.suggestedPrompt === "string",
    )
    .map((item) => {
      const matchedNames = Array.isArray(item.matchedSkillNames) ? item.matchedSkillNames : [];
      const suggestedSkillIds = matchedNames
        .filter((n): n is string => typeof n === "string")
        .map((n) => nameToId.get(n))
        .filter((id): id is string => Boolean(id));

      return {
        suggestedName: String(item.suggestedName).trim(),
        suggestedPrompt: String(item.suggestedPrompt).trim(),
        suggestedSkillIds,
        unmatchedNote:
          typeof item.unmatchedNote === "string" && item.unmatchedNote.trim() && item.unmatchedNote !== "null"
            ? item.unmatchedNote.trim()
            : null,
      };
    })
    .filter((d) => d.suggestedName && d.suggestedPrompt);
}

function parseAnalysisJson(text: string): unknown {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  const jsonText = match ? match[1] : text;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

// 沒有範本時 AI 回傳陣列；有範本時回傳 {faqs, documents} 物件，兩種都接受。
export function parseFaqDrafts(text: string): FaqDraft[] {
  const json = parseAnalysisJson(text);
  const parsed = Array.isArray(json) ? json : (json as { faqs?: unknown } | null)?.faqs;

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && typeof item.question === "string" && typeof item.answer === "string",
    )
    .map((item) => ({
      question: String(item.question).trim(),
      answer: String(item.answer).trim(),
      suggestedTally:
        typeof item.suggestedTally === "string" && item.suggestedTally.trim() && item.suggestedTally !== "null"
          ? item.suggestedTally.trim()
          : null,
    }))
    .filter((f) => f.question && f.answer);
}

export function parseTallyOutput(text: string): TallyOutputDraft {
  const json = parseAnalysisJson(text) as { documents?: unknown; sharedRules?: unknown; relations?: unknown } | null;
  const obj = json && !Array.isArray(json) ? json : {};
  const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
  const cleanStrings = (v: unknown): string[] =>
    asArray(v)
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);

  const sharedRules = new Map<string, SharedRule[]>();
  for (const item of asArray(obj.sharedRules).filter(isRecord)) {
    const template = typeof item.template === "string" ? item.template.trim() : "";
    // 規則可以是 {field, text}，也容忍 AI 只給字串
    const rules = asArray(item.rules)
      .map((r): SharedRule | null => {
        if (typeof r === "string") return r.trim() ? { field: null, text: r.trim() } : null;
        if (!isRecord(r) || typeof r.text !== "string" || !r.text.trim()) return null;
        const field = typeof r.field === "string" && r.field.trim() && r.field.trim() !== "null" ? r.field.trim() : null;
        return { field, text: r.text.trim() };
      })
      .filter((r): r is SharedRule => r !== null);
    if (template && rules.length > 0) sharedRules.set(template, [...(sharedRules.get(template) ?? []), ...rules]);
  }

  const relations = asArray(obj.relations)
    .filter(isRecord)
    .map((r) => ({ items: [...new Set(cleanStrings(r.items))], description: typeof r.description === "string" ? r.description.trim() : "" }))
    .filter((r) => r.items.length >= 2 && r.description);

  return { documents: parseDocumentDrafts(obj.documents), sharedRules, relations };
}

function parseDocumentDrafts(docs: unknown): TallyDocumentDraft[] {
  if (!Array.isArray(docs)) return [];

  return docs
    .filter(
      (d): d is Record<string, unknown> =>
        typeof d === "object" && d !== null && typeof d.template === "string" && typeof d.name === "string",
    )
    .map((d) => {
      const values: Record<string, string | null> = {};
      if (typeof d.values === "object" && d.values !== null) {
        for (const [key, value] of Object.entries(d.values as Record<string, unknown>)) {
          values[key] = typeof value === "string" && value.trim() && value.trim() !== "null" ? value.trim() : null;
        }
      }
      return { template: String(d.template).trim(), name: String(d.name).trim(), values };
    })
    .filter((d) => d.template && d.name);
}

// AI 可能用全形 ＞、› 或多餘空白分隔「維度 > 子維度」，比對前先統一。
function normalizeFieldKey(key: string): string {
  // AI 可能把欄位後面的「（說明：…）」「（補充說明：…）」一起抄進 key，比對前去掉
  return key
    .replace(/（(補充)?說明：[^）]*）/g, "")
    .replace(/[＞›»]/g, ">").replace(/\s*>\s*/g, " > ").replace(/\s+/g, " ").trim();
}

export const MISSING_FIELD_TEXT = "文件未提及";
// 這個欄位實體本身沒寫，但有對應的通用規則
export const SHARED_FIELD_TEXT = "請見下方「通用規則」";

// 由伺服器依範本樹組 markdown：維度順序照分類管理的排序，缺的欄位補「文件未提及」，不依賴 AI 自己排版。
export function buildTallyDocumentMarkdown(
  template: TallyTemplate,
  values: Record<string, string | null>,
  extras: { related?: { others: string[]; description: string }[]; sharedRules?: SharedRule[]; missingText?: string } = {},
): string {
  const lookup = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    if (value) lookup.set(normalizeFieldKey(key), value);
  }
  // 有通用規則對應的欄位：實體自己沒寫時指向下方的通用規則，而不是寫「文件未提及」
  const sharedFields = new Set((extras.sharedRules ?? []).flatMap((r) => (r.field ? [normalizeFieldKey(r.field)] : [])));
  const missing = (key: string) =>
    sharedFields.has(normalizeFieldKey(key)) ? SHARED_FIELD_TEXT : (extras.missingText ?? MISSING_FIELD_TEXT);

  const lines: string[] = [];
  for (const h2 of template.children) {
    lines.push(`## ${h2.name}`, "");
    const overview = lookup.get(normalizeFieldKey(h2.name));
    if (h2.children.length === 0) {
      lines.push(overview ?? missing(h2.name), "");
      continue;
    }
    if (overview) lines.push(overview, "");
    for (const h3 of h2.children) {
      const key = `${h2.name} > ${h3.name}`;
      lines.push(`### ${h3.name}`, "", lookup.get(normalizeFieldKey(key)) ?? missing(key), "");
    }
  }

  // 系統產生的段落：跟其他實體的關聯（雙向一致），以及這個範本所有實體共用的通用規則
  if (extras.related && extras.related.length > 0) {
    lines.push("## 相關項目", "");
    for (const r of extras.related) lines.push(`- **${r.others.join("、")}**：${r.description}`);
    lines.push("");
  }
  // 實體自己在某欄位寫了內容（例外），就不再附上同一欄位的通用規則，避免同一份文件前後矛盾
  const applicableRules = (extras.sharedRules ?? []).filter((r) => !r.field || !lookup.has(normalizeFieldKey(r.field)));
  if (applicableRules.length > 0) {
    lines.push(`## 通用規則（適用所有${template.name}）`, "");
    for (const rule of applicableRules) lines.push(`- ${rule.text}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

// 判斷兩個實體是不是同一個：忽略大小寫、全形半形、空白與連字號（「L600」「L-600」「ｌ６００」視為同一個）
export function entityKey(template: string, name: string): string {
  return `${template}\u0000${entityNameKey(name)}`;
}

export function entityNameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[\s\-_－—–‐・.]/g, "");
}
