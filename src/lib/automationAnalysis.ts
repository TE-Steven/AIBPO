import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { cleanFields, FIELD_TYPES, type AutomationField, type AutomationPageInfo } from "@/lib/automationFields";

// 自動化管理：把瀏覽器擷取到的表單頁面資訊（截圖、可見文字、原生欄位、頁面載入的設定資料）交給 Claude，整理成欄位清單。

// 瀏覽器擷取到的原生欄位（input／select／textarea 等）
export type RawControl = {
  ref: string;
  tag: string;
  type: string;
  name: string | null;
  id: string | null;
  label: string | null;
  placeholder: string | null;
  required: boolean;
  options: { value: string; label: string }[];
  maxLength: number | null;
  pattern: string | null;
  role: string | null;
  selector: string | null;
};

export type PageCapture = {
  url: string;
  title: string;
  text: string;
  controls: RawControl[];
  // 頁面自己載入的 JSON 設定資料（只拿來讓欄位分析更準，不會用來送出）
  payloads: { url: string; body: string }[];
  screenshot: string | null;
  submitText: string | null;
};

const MAX_OPTIONS = 150;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    notes: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          type: { type: "string", enum: [...FIELD_TYPES] },
          required: { type: "boolean" },
          description: { type: "string" },
          levels: { type: "array", items: { type: "string" } },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: { value: { type: "string" }, label: { type: "string" }, parent: { type: "string" } },
              required: ["value", "label", "parent"],
              additionalProperties: false,
            },
          },
          maxLength: { type: "integer" },
          minLength: { type: "integer" },
          pattern: { type: "string" },
          controlRef: { type: "string" },
        },
        required: ["key", "label", "type", "required", "description", "levels", "options", "maxLength", "minLength", "pattern", "controlRef"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "description", "notes", "fields"],
  additionalProperties: false,
};

const SYSTEM = `你是表單分析助手。使用者會給你一個網頁表單的截圖、頁面可見文字、瀏覽器擷取到的原生欄位清單，以及頁面載入的設定資料（JSON）。請整理出「填表的人要填的欄位清單」，之後會依這份清單產生 API，讓系統代為填寫。
規則：
- 只列填表的人會看到、會填的欄位；隱藏欄位、驗證用的 token、防機器人的隱藏欄位都不要列。
- 欄位順序照畫面由上到下。label 用畫面上的欄位名稱（繁體中文照抄）。
- key 是 API 參數名稱：小寫英文、數字、底線，有意義（例如 customer_name、phone、purchase_channel），不能重複。
- type 從清單選最貼近的：文字 text、多行 textarea、數字 number、email、電話 phone、日期 date、時間 time、下拉 select、單選 radio、勾選 checkbox、多選 multiselect、階層下拉 cascade（例如 品牌 > 類型 > 型號）、檔案 file。
- required：畫面標 *、原生欄位 required，或設定資料標示必填的才算必填。
- options：下拉、單選、多選、階層下拉的選項。value 用設定資料或原生欄位的值（沒有就跟 label 一樣），label 用畫面文字。階層下拉的子選項 parent 填上一層選項 value 的完整路徑（用「 > 」連接），第一層 parent 填空字串；levels 填每一層的名稱。其他類型 options 給空陣列、parent 都填空字串。
- 選項超過 ${MAX_OPTIONS} 個的欄位（例如型號清單），options 只列前 ${MAX_OPTIONS} 個，並在 description 註明選項很多、只列部分。
- maxLength、minLength 沒有限制填 0；pattern 沒有填空字串。
- controlRef：這個欄位對應到原生欄位清單裡的 ref（例如 c3）；是自訂元件、對應不到的填空字串。
- description 用一句繁體中文說明這個欄位要填什麼（可以參考畫面上的提示文字）。
- notes：給管理員的備註，例如哪些欄位是自訂元件要人工確認、有沒有看起來需要上傳檔案或其他特殊步驟。
- title、description：表單標題與畫面上的表單說明。`;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…（以下省略）` : text;
}

export async function analyzeFormCapture(
  capture: PageCapture,
  roleId: string,
): Promise<{ fields: AutomationField[]; pageInfo: Omit<AutomationPageInfo, "blockers"> }> {
  const controlsText = capture.controls
    .map((c) =>
      JSON.stringify({
        ref: c.ref,
        tag: c.tag,
        type: c.type,
        name: c.name,
        label: c.label,
        placeholder: c.placeholder,
        required: c.required,
        options: c.options.slice(0, MAX_OPTIONS),
        maxLength: c.maxLength,
        pattern: c.pattern,
        role: c.role,
      }),
    )
    .join("\n");
  let payloadBudget = 60_000;
  const payloadText = capture.payloads
    .map((p) => {
      const body = truncate(p.body, Math.max(0, payloadBudget));
      payloadBudget -= body.length;
      return body ? `<payload url="${p.url}">\n${body}\n</payload>` : "";
    })
    .filter(Boolean)
    .join("\n");

  const content: Anthropic.ContentBlockParam[] = [];
  if (capture.screenshot) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: capture.screenshot } });
  }
  content.push({
    type: "text",
    text: [
      `<url>${capture.url}</url>`,
      `<page_title>${capture.title}</page_title>`,
      capture.submitText ? `<submit_button>${capture.submitText}</submit_button>` : "",
      `<visible_text>\n${truncate(capture.text, 15_000)}\n</visible_text>`,
      `<native_controls>\n${controlsText || "（沒有擷取到原生欄位，可能全部是自訂元件）"}\n</native_controls>`,
      payloadText ? `<page_payloads>\n${payloadText}\n</page_payloads>` : "",
      "請依照系統指示整理欄位清單。",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  const response = await anthropic.messages
    .stream({
      model: KM_ANALYSIS_MODEL,
      max_tokens: 32_000,
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    })
    .finalMessage();
  await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "automation_analyze", usage: response.usage, roleId });
  if (response.stop_reason === "max_tokens") throw new Error("表單太複雜，AI 的分析結果太長被截斷。");

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as {
    title: string;
    description: string;
    notes: string;
    fields: {
      key: string;
      label: string;
      type: string;
      required: boolean;
      description: string;
      levels: string[];
      options: { value: string; label: string; parent: string }[];
      maxLength: number;
      minLength: number;
      pattern: string;
      controlRef: string;
    }[];
  };
  const byRef = new Map(capture.controls.map((c) => [c.ref, c]));
  const fields = cleanFields(
    parsed.fields.map((f) => {
      const control = f.controlRef ? byRef.get(f.controlRef) : undefined;
      return {
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        description: f.description,
        levels: f.levels,
        options: f.options.map((o) => ({ value: o.value, label: o.label, parent: o.parent || null })),
        constraints: {
          maxLength: f.maxLength > 0 ? f.maxLength : null,
          minLength: f.minLength > 0 ? f.minLength : null,
          pattern: f.pattern || null,
        },
        hidden: false,
        defaultValue: null,
        locator: control ? { name: control.name, id: control.id, label: control.label, selector: control.selector } : { label: f.label },
      };
    }),
  );
  return { fields, pageInfo: { title: parsed.title, description: parsed.description, submitText: capture.submitText, notes: parsed.notes } };
}
