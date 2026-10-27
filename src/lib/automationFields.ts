// 自動化管理的欄位清單：AI 分析表單後整理出來、管理員可以修改，之後產生 API 與代為填寫都照這份清單。

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "email",
  "phone",
  "date",
  "time",
  "select",
  "radio",
  "checkbox",
  "multiselect",
  "cascade",
  "file",
] as const;
export type AutomationFieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<AutomationFieldType, string> = {
  text: "文字",
  textarea: "多行文字",
  number: "數字",
  email: "Email",
  phone: "電話",
  date: "日期",
  time: "時間",
  select: "下拉選單",
  radio: "單選",
  checkbox: "勾選",
  multiselect: "多選",
  cascade: "階層下拉",
  file: "檔案",
};

// 選項：階層下拉的子選項用 parent（上一層選項的 value 路徑，用「 > 」連接）表示，不用巢狀
export type AutomationOption = { value: string; label: string; parent?: string | null };

// 定位資訊：之後用瀏覽器填寫時找到這個欄位（擷取到的原生欄位才有）
export type FieldLocator = { name?: string | null; id?: string | null; label?: string | null; selector?: string | null };

export type AutomationField = {
  key: string;
  label: string;
  type: AutomationFieldType;
  required: boolean;
  description: string;
  options: AutomationOption[];
  // 階層下拉每一層的名稱（例如 品牌 > 類型）
  levels: string[];
  constraints: { maxLength?: number | null; minLength?: number | null; pattern?: string | null; min?: number | null; max?: number | null };
  // 管理員設定：不讓 API 填（例如內部欄位）、預設值
  hidden: boolean;
  defaultValue: string | null;
  locator: FieldLocator | null;
};

// 頁面資訊：給管理員看的分析摘要
export type AutomationPageInfo = {
  title: string;
  description: string;
  submitText: string | null;
  // 偵測到的不支援情況（驗證碼、登入、付款）
  blockers: string[];
  // AI 的備註（例如哪些欄位是自訂元件、要人工確認）
  notes: string;
};

const KEY_RE = /^[a-z][a-z0-9_]{0,49}$/;

export function toFieldKey(raw: string, fallback: string): string {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 50);
  return KEY_RE.test(key) ? key : fallback;
}

// 清理欄位清單（AI 輸出、管理員修改後都過一次）：型別、參數名稱唯一、選項去空
export function cleanFields(input: unknown): AutomationField[] {
  if (!Array.isArray(input)) return [];
  const used = new Set<string>();
  return input.flatMap((raw, i): AutomationField[] => {
    const r = (raw ?? {}) as Partial<AutomationField>;
    const label = String(r.label ?? "").trim();
    if (!label) return [];
    let key = toFieldKey(String(r.key ?? ""), `field_${i + 1}`);
    while (used.has(key)) key = `${key}_${i + 1}`;
    used.add(key);
    const type = (FIELD_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as AutomationFieldType) : "text";
    const options = Array.isArray(r.options)
      ? r.options
          .map((o) => ({ value: String(o?.value ?? "").trim(), label: String(o?.label ?? o?.value ?? "").trim(), parent: o?.parent ? String(o.parent) : null }))
          .filter((o) => o.value || o.label)
          .map((o) => ({ ...o, value: o.value || o.label }))
      : [];
    const c = (r.constraints ?? {}) as AutomationField["constraints"];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return [
      {
        key,
        label: label.slice(0, 100),
        type,
        required: Boolean(r.required),
        description: String(r.description ?? "").trim().slice(0, 500),
        options,
        levels: Array.isArray(r.levels) ? r.levels.map((l) => String(l).trim()).filter(Boolean) : [],
        constraints: {
          maxLength: num(c.maxLength),
          minLength: num(c.minLength),
          pattern: c.pattern ? String(c.pattern).slice(0, 200) : null,
          min: num(c.min),
          max: num(c.max),
        },
        hidden: Boolean(r.hidden),
        defaultValue: r.defaultValue === undefined || r.defaultValue === null || r.defaultValue === "" ? null : String(r.defaultValue),
        locator: r.locator && typeof r.locator === "object" ? (r.locator as FieldLocator) : null,
      },
    ];
  });
}

export function cleanPageInfo(input: unknown): AutomationPageInfo {
  const r = (input ?? {}) as Partial<AutomationPageInfo>;
  return {
    title: String(r.title ?? "").trim(),
    description: String(r.description ?? "").trim(),
    submitText: r.submitText ? String(r.submitText) : null,
    blockers: Array.isArray(r.blockers) ? r.blockers.map(String) : [],
    notes: String(r.notes ?? "").trim(),
  };
}

export const AUTOMATION_STATUS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "等待分析", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  ANALYZING: { label: "分析中", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  READY: { label: "待確認", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  ACTIVE: { label: "已啟用", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  BLOCKED: { label: "不支援", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  FAILED: { label: "分析失敗", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};
