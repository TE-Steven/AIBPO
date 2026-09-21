import type Anthropic from "@anthropic-ai/sdk";
import type { KmEntry, KmSource, Tally } from "@/generated/prisma/client";

export type FaqDraft = { question: string; answer: string; suggestedTally: string | null };
export type WorkflowDraft = {
  suggestedName: string;
  suggestedPrompt: string;
  suggestedSkillIds: string[];
  unmatchedNote: string | null;
};

export function buildSystemPrompt(params: {
  dimensions: string[];
  tallies: Tally[];
  countMin: number;
  countMax: number;
  answerStyle?: string;
  guidelines?: string;
}): string {
  const { dimensions, tallies, countMin, countMax, answerStyle, guidelines } = params;

  const dimensionsText =
    dimensions.length > 0
      ? dimensions.map((d) => `- ${d}`).join("\n")
      : "（使用者沒有指定特定維度，請你自行判斷內容中最值得整理成 FAQ 的重點）";

  const tallyText =
    tallies.length > 0
      ? `\n你也可以參考以下分類清單，為每一題建議最適合歸類的分類名稱（從清單中選一個最貼近的名稱，完全比對不到就填 null，不要自己發明新分類名稱）：\n${tallies
          .map((t) => `- ${t.name}`)
          .join("\n")}\n`
      : "";

  const answerStyleText = answerStyle?.trim()
    ? `\n使用者對「答案」的輸出風格有以下額外要求，請務必遵守：\n${answerStyle.trim()}\n`
    : "";

  const guidelinesBlock = guidelines?.trim()
    ? `【最高準則，優先於本提示詞裡的其他任何指示，一定要遵守】\n${guidelines.trim()}\n\n---\n\n`
    : "";

  return `${guidelinesBlock}你是知識庫建置助手（Knowledge Management）。使用者會提供一份文件或一個網頁，你要仔細閱讀全文內容，根據下面指定的「分析維度」，找出所有適合整理成 FAQ（常見問題集）的題目與答案組合。

請全程使用繁體中文思考與作答，包括你的思考過程也請用繁體中文書寫。

分析維度：
${dimensionsText}
${tallyText}${answerStyleText}
請產出介於 ${countMin} 到 ${countMax} 題之間的 FAQ，每一題必須：
- 題目要像真實使用者會問的問題，具體、口語化
- 答案要根據文件內容回答，不要虛構或超出文件範圍的內容
- 同一個題目不要重複出現
- 用第一人稱、客服的口吻直接回答，就當作你自己就是這個品牌/單位在回覆顧客，把文件內容當作「你自己知道的事」直接講出來；不要用「網站目前提供…」「文件提到…」「根據內容顯示…」這種轉述第三方來源的寫法
- 不要加「實際以官網公告為準」「詳情請洽詢」「請以最新資訊為準」這類模稜兩可、把責任推回去的免責聲明——文件裡寫的資訊就是確定的答案，直接肯定地講出來就好
- 如果內容本質上是價目表、規格比較、方案對照這種有多個項目、多個欄位互相對應的資料，不要把它拆成一條條零碎的問答（會破壞項目與欄位之間的對應關係，之後容易被誤讀或誤答）。這種情況請整合成一題，答案用 markdown 表格完整呈現，保留完整的行列對應

完成你的分析與思考後，在回應的最後面，輸出一個 \`\`\`json 區塊（只能有這一個 json 區塊），內容是一個陣列，格式如下，不要在 json 區塊內加註解或其他文字：

\`\`\`json
[{"question": "...", "answer": "...", "suggestedTally": "分類名稱或 null"}]
\`\`\``;
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

export function buildUserContent(source: KmSource): Anthropic.MessageParam["content"] {
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
  instructions.push(
    files.length + urls.length > 1
      ? "以上這些請視為同一個知識來源合併分析，依照系統指示產出 FAQ。"
      : "請依照系統指示產出 FAQ。",
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

export function buildRagSystemPrompt(): string {
  return `你是文件重排整理助手。使用者會提供一份文件或一個網頁，這份內容原本可能因為 PDF 分頁、排版等因素，導致段落被硬生生切斷、表格斷裂、或夾雜頁首頁尾雜訊。

請全程使用繁體中文思考與作答。你的任務**不是**把內容拆解成問答，而是把整份文件的原始資訊重新排版成一份乾淨、連貫、易讀、對下游系統友善的 markdown 文件。**請假設下游的 RAG 系統完全沒有智能**——不會幫內容補情境、不會做語意理解，就是最陽春的固定長度切塊加關鍵字/向量搜尋，所以本來該由檢索系統做的事，你都要預先寫進文件本身：

**結構**
- 把被分頁切斷的段落、表格重新接回去，恢復完整的語意單位
- 一個標題（不管 H1 或 H2）只講一個主題，標題本身要能單獨看懂，不能只靠上一層標題才理解在講什麼
- 段落要自足，禁止「如上所述」「同前條」「詳見前頁」這種依賴上下文才成立的指代寫法
- 移除頁首、頁尾、頁碼這類跟內容本身無關的雜訊；如果原始內容是網頁，額外要濾掉導覽列、相關文章推薦、留言區、cookie 同意條這類非正文的爬蟲雜訊
- 保留文件原本的資訊與用詞，不要摘要、不要省略、不要改寫語意，只整理格式、結構與寫法

**內容要能被單獨切出來也看得懂（最關鍵的一條）**
- 每個標題底下的內容一開始，都要有一句肉眼可見的完整句子，明講「這段在講哪個品牌/文件/主題」，例如「以下說明追覓吹風機的保固與維修政策」。不是隱藏的 metadata，是正常寫在內文裡的一句話——這樣即使下游系統把文件切成任意大小的片段，不管切到哪一塊，只要涵蓋到段落開頭附近，都能看出這段在講什麼
- 時間、金額寫絕對值：原文有給明確日期就換算寫死，不要保留「即日起」「目前」這種相對說法；原文沒給日期就照實保留，不要自己編一個日期
- 適用範圍與例外要跟結論寫在同一段裡，不要拆到別段或省略（例如「僅限 A、B 機種，C 機種不適用」要跟前面的結論放在一起）

**表格**
- 保留成 markdown table 的同時，額外在旁邊補一段把表格內容攤平成完整句子的敘述（例如「A方案月租299元，含10GB流量」），因為下游系統可能連表格的欄位對應語意都解析不好

直接輸出整理後的 markdown 全文，不要加開場白或結語，也不要用 json 區塊包起來。即使你需要先用工具讀取網頁內容，讀取完成後也要直接接著輸出整理後的 markdown 本文，不要加「好的」「以下是」「整理完成」這類過渡句或任何說明你正在做什麼的句子——你的完整回應從第一個字開始就必須是文件本身的內容（例如一個標題），不能是任何其他文字。`;
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

export function parseFaqDrafts(text: string): FaqDraft[] {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  const jsonText = match ? match[1] : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

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
