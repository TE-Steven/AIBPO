// KM 提示詞與參數設定：每條規則一個編號（對應說明文件的 F/D/R/J 編號），可開關、可改文字。
// 預設值＝程式原本寫死的提示詞；公司在「Prompt 管理」改過的部分存在 SystemSetting（km_prompt_config），執行時覆蓋預設。
// 這個檔案是純資料＋純函式，伺服器（組 prompt）和設定頁（編輯、預覽）共用。

export type PromptSection = "faq" | "doc" | "rag" | "judge";

export type RuleDef = {
  id: string;
  section: PromptSection;
  // 在提示詞裡屬於哪一段（設定頁用來分組顯示）
  group: string;
  label: string;
  hint?: string;
  defaultText: string;
  // false：一定會放進提示詞（只能改文字）
  toggleable: boolean;
  // false：程式依賴這段文字，不開放修改
  editable: boolean;
  // 依賴的規則關閉時，這條也不會放進提示詞
  dependsOn?: string;
  // 可以一鍵套用的替代寫法
  presets?: { label: string; text: string }[];
  // 文字裡可以用的變數
  placeholders?: string[];
};

export type RuleOverride = { enabled?: boolean; text?: string };

export type PromptOptions = {
  faqCountMin: number;
  faqCountMax: number;
  docMissingText: string;
  docOverviewField: boolean;
  // 整份結構化文件下載時，維度標題前面加上項目名稱（「L600｜價格」），切塊後仍看得出是哪個項目
  docSelfContainedHeadings: boolean;
  exportFrontmatter: boolean;
  exportGroupBy: "tally" | "source" | "none";
  exportQuestionFormat: "h3" | "bold" | "numbered";
  exportIncludeDocs: boolean;
};

export type PromptConfigData = {
  rules?: Record<string, RuleOverride>;
  options?: Partial<PromptOptions>;
};

export const PROMPT_CONFIG_KEY = "km_prompt_config";

export const DEFAULT_OPTIONS: PromptOptions = {
  faqCountMin: 10,
  faqCountMax: 30,
  docMissingText: "文件未提及",
  docOverviewField: true,
  docSelfContainedHeadings: true,
  exportFrontmatter: true,
  exportGroupBy: "tally",
  exportQuestionFormat: "h3",
  exportIncludeDocs: true,
};

const LANGUAGE_TEXT = "請全程使用繁體中文思考與作答，包括你的思考過程也請用繁體中文書寫。";

export const RULES: RuleDef[] = [
  // ---------------- FAQ ----------------
  {
    id: "faq.intro",
    section: "faq",
    group: "角色與任務",
    label: "角色與任務說明",
    defaultText:
      "你是知識庫建置助手（Knowledge Management）。使用者會提供一份文件或一個網頁，你要仔細閱讀全文內容，根據下面指定的「分析維度」，找出所有適合整理成 FAQ（常見問題集）的題目與答案組合。",
    toggleable: false,
    editable: true,
  },
  {
    id: "faq.language",
    section: "faq",
    group: "角色與任務",
    label: "語言",
    defaultText: LANGUAGE_TEXT,
    toggleable: false,
    editable: true,
  },
  {
    id: "F10",
    section: "faq",
    group: "分類歸類",
    label: "分類歸類說明",
    hint: "分析時勾選「把 Tally 分類也當作維度依據」才會出現，後面會自動接上分類完整路徑清單。",
    defaultText:
      "你也可以參考以下分類清單，為每一題建議最適合歸類的分類（「>」表示上下層；請照抄清單中的一整行完整路徑，完全比對不到就填 null，不要自己發明新分類）：",
    toggleable: false,
    editable: true,
  },
  {
    id: "F1",
    section: "faq",
    group: "每一題的規則",
    label: "題目風格",
    defaultText: "題目要像真實使用者會問的問題，具體、口語化",
    toggleable: true,
    editable: true,
    presets: [
      { label: "口語（預設）", text: "題目要像真實使用者會問的問題，具體、口語化" },
      { label: "正式", text: "題目用正式、完整的書面語寫成，具體明確，避免口語與縮寫" },
    ],
  },
  {
    id: "F2",
    section: "faq",
    group: "每一題的規則",
    label: "只根據文件",
    defaultText: "答案要根據文件內容回答，不要虛構或超出文件範圍的內容",
    toggleable: false,
    editable: true,
  },
  {
    id: "F3",
    section: "faq",
    group: "每一題的規則",
    label: "題目不重複",
    defaultText: "同一個題目不要重複出現",
    toggleable: false,
    editable: true,
  },
  {
    id: "F4",
    section: "faq",
    group: "每一題的規則",
    label: "回答口吻",
    defaultText:
      "用第一人稱、客服的口吻直接回答，就當作你自己就是這個品牌/單位在回覆顧客，把文件內容當作「你自己知道的事」直接講出來；不要用「網站目前提供…」「文件提到…」「根據內容顯示…」這種轉述第三方來源的寫法",
    toggleable: true,
    editable: true,
    presets: [
      {
        label: "第一人稱客服（預設）",
        text: "用第一人稱、客服的口吻直接回答，就當作你自己就是這個品牌/單位在回覆顧客，把文件內容當作「你自己知道的事」直接講出來；不要用「網站目前提供…」「文件提到…」「根據內容顯示…」這種轉述第三方來源的寫法",
      },
      {
        label: "中立說明",
        text: "用中立、客觀的第三人稱說明口吻回答，直接陳述事實，不使用「我們」「本公司」等第一人稱，也不要用「文件提到…」這種轉述寫法",
      },
    ],
  },
  {
    id: "F5",
    section: "faq",
    group: "每一題的規則",
    label: "不加免責聲明",
    defaultText:
      "不要加「實際以官網公告為準」「詳情請洽詢」「請以最新資訊為準」這類模稜兩可、把責任推回去的免責聲明——文件裡寫的資訊就是確定的答案，直接肯定地講出來就好",
    toggleable: true,
    editable: true,
  },
  {
    id: "F6",
    section: "faq",
    group: "每一題的規則",
    label: "表格類資料合併成一題",
    defaultText:
      "如果內容本質上是價目表、規格比較、方案對照這種有多個項目、多個欄位互相對應的資料，不要把它拆成一條條零碎的問答（會破壞項目與欄位之間的對應關係，之後容易被誤讀或誤答）。這種情況請整合成一題，答案用 markdown 表格完整呈現，保留完整的行列對應",
    toggleable: true,
    editable: true,
  },

  // ---------------- 結構化文件 ----------------
  {
    id: "doc.intro",
    section: "doc",
    group: "角色與任務",
    label: "角色說明",
    defaultText: "你是知識庫建置助手（Knowledge Management）。使用者會提供一份文件或一個網頁，你要依照下面的「文件範本」把內容整理成結構化文件。",
    toggleable: false,
    editable: true,
  },
  { id: "doc.language", section: "doc", group: "角色與任務", label: "語言", defaultText: LANGUAGE_TEXT, toggleable: false, editable: true },
  {
    id: "doc.task",
    section: "doc",
    group: "角色與任務",
    label: "任務說明",
    hint: "後面會自動接上每個範本的欄位清單。",
    defaultText:
      "每個範本代表一種實體（例如「產品型號」）。請仔細讀完全文，找出文件中所有屬於這一類的實體（例如每一個型號），一個都不要漏；每個實體整理成一份文件，逐一填寫範本的每個欄位：",
    toggleable: false,
    editable: true,
  },
  {
    id: "D1",
    section: "doc",
    group: "欄位規則",
    label: "只根據文件，沒提到填 null",
    defaultText: "欄位內容只能根據文件內容，文件沒有提到的欄位一律填 null，不要猜測或補寫",
    toggleable: false,
    editable: true,
  },
  {
    id: "D2",
    section: "doc",
    group: "欄位規則",
    label: "每項資訊只放一個欄位",
    defaultText: "每一項資訊只放在最貼切的一個欄位，不要在多個欄位重複同樣的內容；「補充說明」欄位絕對不要重複子欄位已經寫過的資訊",
    toggleable: true,
    editable: true,
  },
  {
    id: "D3",
    section: "doc",
    group: "欄位規則",
    label: "肯定句，不猜測",
    defaultText:
      "用肯定、精簡的陳述句直接寫出事實；不要用「/」並列來猜測（例如「門鎖/設備」），也不要寫「可能」「應該」這類模稜兩可的字眼——文件沒有明確說的就不寫",
    toggleable: true,
    editable: true,
  },
  {
    id: "D4",
    section: "doc",
    group: "欄位規則",
    label: "完整保留數字與條件",
    defaultText: "完整保留文件中的數字、單位、條件、範圍與例外情況，不要四捨五入、概括或省略",
    toggleable: true,
    editable: true,
  },
  {
    id: "D5",
    section: "doc",
    group: "欄位規則",
    label: "彙整散落的資訊",
    defaultText: "同一個實體在文件不同地方提到的資訊，要彙整到同一份文件裡",
    toggleable: true,
    editable: true,
  },
  {
    id: "D6",
    section: "doc",
    group: "欄位規則",
    label: "內容格式",
    defaultText: "欄位內容可以用 markdown（條列、表格），但不要加標題（#），標題會由系統依範本產生",
    toggleable: false,
    editable: false,
  },
  {
    id: "D7",
    section: "doc",
    group: "欄位規則",
    label: "使用正式名稱",
    defaultText: "name 用文件中該實體的正式名稱（例如型號名稱）",
    toggleable: false,
    editable: true,
  },
  {
    id: "D8",
    section: "doc",
    group: "欄位規則",
    label: "同一實體合併",
    defaultText: "同一個實體只能輸出一份；文件裡用不同寫法（大小寫、空格、連字號）指的是同一個實體時，合併成一份",
    toggleable: false,
    editable: true,
  },
  {
    id: "D9",
    section: "doc",
    group: "欄位規則",
    label: "找不到就不產出",
    defaultText: "文件裡找不到屬於某個範本的實體，就不要產出那個範本的文件",
    toggleable: false,
    editable: true,
  },
  {
    id: "D10",
    section: "doc",
    group: "欄位規則",
    label: "欄位名稱一致",
    defaultText: "values 的 key 必須和上面列出的欄位名稱完全一樣",
    toggleable: false,
    editable: false,
  },
  {
    id: "D17",
    section: "doc",
    group: "RAG 可讀性",
    label: "條列完整句",
    hint: "對應 RAG 規則 R7。",
    defaultText: "欄位內容若用條列，每一點都要是能單獨看懂的完整句子（講清楚主詞與結論），不要只寫名詞片語",
    toggleable: true,
    editable: true,
  },
  {
    id: "D18",
    section: "doc",
    group: "RAG 可讀性",
    label: "圖片資訊轉文字",
    hint: "對應 RAG 規則 R8。",
    defaultText:
      "文件中圖片、示意圖、圖示裡的資訊（例如 ✓／✗ 正確與錯誤做法對照圖、流程圖、尺寸標示圖），要轉寫成文字填進對應欄位，不能略過，也不要寫「如圖所示」這種依賴圖片的說法",
    toggleable: true,
    editable: true,
  },
  {
    id: "D19",
    section: "doc",
    group: "RAG 可讀性",
    label: "內容自足、禁止指代",
    hint: "對應 RAG 規則 R9。",
    defaultText:
      "每個欄位的內容都要能單獨看懂：禁止「如上所述」「上述」「同前條」「詳見前頁」這類依賴上下文的指代寫法，需要時直接寫出實體名稱與具體內容",
    toggleable: true,
    editable: true,
  },
  {
    id: "D20",
    section: "doc",
    group: "RAG 可讀性",
    label: "時間與金額寫絕對值",
    hint: "對應 RAG 規則 R13。",
    defaultText: "時間、金額、規格寫絕對值：原文有給明確日期就換算寫死，不要保留「即日起」「目前」這種相對說法；原文沒給日期就照實保留，不要自己編一個日期",
    toggleable: true,
    editable: true,
  },
  {
    id: "D21",
    section: "doc",
    group: "RAG 可讀性",
    label: "表格攤平成句子",
    hint: "對應 RAG 規則 R16。",
    defaultText: "欄位內容若用 markdown 表格，要在表格後面補一段把表格內容攤平成完整句子的敘述（例如「A方案月租299元，含10GB流量」），因為下游系統可能解析不好表格的欄位對應",
    toggleable: true,
    editable: true,
  },
  {
    id: "D11",
    section: "doc",
    group: "通用規則",
    label: "附上通用規則",
    hint: "關閉後整段「通用規則」不會出現，文件最後也不會附通用規則。",
    defaultText:
      "文件中適用於某個範本「所有」實體的規則（例如「所有型號主機保固 2 年」「全系列皆需由專人安裝」），不要寫進各實體的欄位，改列在 sharedRules：text 寫成一句完整、能單獨看懂的句子；field 填這條規則對應的欄位名稱（跟上面列出的欄位名稱完全一樣），沒有對應欄位就填 null。系統會自動把它附在該範本每一份文件的最後",
    toggleable: true,
    editable: true,
  },
  {
    id: "D12",
    section: "doc",
    group: "通用規則",
    label: "部分實體的規則",
    defaultText: "只適用其中「部分」實體的規則（例如「L 系列皆支援…」），不算通用規則，請寫進那些實體各自對應的欄位",
    toggleable: true,
    editable: true,
    dependsOn: "D11",
  },
  {
    id: "D13",
    section: "doc",
    group: "通用規則",
    label: "例外寫進該實體",
    defaultText: "某個實體是通用規則的例外時（例如其他型號保固 2 年、只有 L700 保固 3 年），把例外寫進該實體的對應欄位",
    toggleable: true,
    editable: true,
    dependsOn: "D11",
  },
  {
    id: "D14",
    section: "doc",
    group: "關聯",
    label: "雙向相關項目",
    hint: "關閉後整段「關聯」不會出現，文件也不會有「相關項目」段落。",
    defaultText:
      "實體之間在文件中有明確關係時（例如「A 與 B 一起購買享 9 折」「C 是 D 的專用配件」「E 為 F 的升級款」），每一筆關係只列一次：items 放所有相關實體的名稱（兩個以上，用跟 documents 的 name 一樣的寫法），description 用一句完整的話說明這個關係",
    toggleable: true,
    editable: true,
  },
  {
    id: "D15",
    section: "doc",
    group: "關聯",
    label: "不在欄位重複關聯",
    defaultText: "系統會把同一筆關係同時寫進每一個相關實體的文件，所以不需要、也不要在各實體的欄位裡重複描述這個關係",
    toggleable: true,
    editable: true,
    dependsOn: "D14",
  },
  {
    id: "D16",
    section: "doc",
    group: "關聯",
    label: "關聯不推論",
    defaultText: "關係只能根據文件內容，文件沒有明講的關係不要自己推論",
    toggleable: true,
    editable: true,
    dependsOn: "D14",
  },

  // ---------------- RAG 內容 ----------------
  {
    id: "rag.intro",
    section: "rag",
    group: "角色與任務",
    label: "角色說明",
    defaultText:
      "你是文件重排整理助手。使用者會提供一份文件或一個網頁，這份內容原本可能因為 PDF 分頁、排版等因素，導致段落被硬生生切斷、表格斷裂、或夾雜頁首頁尾雜訊。",
    toggleable: false,
    editable: true,
  },
  {
    id: "R0",
    section: "rag",
    group: "角色與任務",
    label: "任務與核心假設",
    defaultText:
      "請全程使用繁體中文思考與作答。你的任務**不是**把內容拆解成問答，而是把整份文件的原始資訊重新排版成一份乾淨、連貫、易讀、對下游系統友善的 markdown 文件。**請假設下游的 RAG 系統完全沒有智能**——不會幫內容補情境、不會做語意理解，就是最陽春的固定長度切塊加關鍵字/向量搜尋，所以本來該由檢索系統做的事，你都要預先寫進文件本身：",
    toggleable: false,
    editable: true,
  },
  {
    id: "R1",
    section: "rag",
    group: "開頭區塊",
    label: "文件資訊區塊",
    hint: "{doc_id}、{source} 會由系統自動填入，不要刪掉。",
    placeholders: ["{doc_id}", "{source}"],
    defaultText: [
      "`## 文件資訊`：條列 5 個欄位，格式是 `- **欄位名**：內容`：",
      "   - **product**：這份文件是關於哪個產品/服務，從內容判斷",
      "   - **category**：這份文件的類型分類（例如「產品 / 安裝規範」「售後 / 保固政策」），從內容判斷",
      "   - **doc_id**：固定填「{doc_id}」，不要自己發明或修改",
      "   - **scope**：這份內容適用的範圍與不適用的例外，從內容判斷；沒有明確範圍限制就填「無特別限制」",
      "   - **source**：固定填「{source}」，不要自己發明或修改",
    ].join("\n"),
    toggleable: true,
    editable: true,
  },
  {
    id: "R2",
    section: "rag",
    group: "開頭區塊",
    label: "本文回答哪些問題",
    defaultText:
      "`## 本文回答哪些問題`：條列這份文件實際能回答的問題，**用真實使用者/顧客會問的口語說法寫**，不要用文件本身的標題或正式術語照抄一遍（例如該寫「刷臉一直打不開怎麼辦」，不要寫「人臉辨識異常之排除方式」）。",
    toggleable: true,
    editable: true,
  },
  {
    id: "R3",
    section: "rag",
    group: "開頭區塊",
    label: "常見說法對照",
    defaultText:
      "列完問題後，緊接著補一段「常見說法對照」，把同一個症狀/情境的口語講法跟文件內文會用的正式用詞對應起來（例如「刷臉打不開／認不出我的臉／偵測不到人 = 人臉辨識異常」），這樣即使使用者用口語搜尋，關鍵字也對得上文件正文用詞",
    toggleable: true,
    editable: true,
    dependsOn: "R2",
  },
  {
    id: "R4",
    section: "rag",
    group: "結構",
    label: "接回斷裂段落",
    defaultText: "把被分頁切斷的段落、表格重新接回去，恢復完整的語意單位",
    toggleable: true,
    editable: true,
  },
  {
    id: "R5",
    section: "rag",
    group: "結構",
    label: "標題單獨看懂",
    defaultText: "一個標題（不管 H1 或 H2）只講一個主題，標題本身要能單獨看懂，不能只靠上一層標題才理解在講什麼",
    toggleable: true,
    editable: true,
  },
  {
    id: "R6",
    section: "rag",
    group: "結構",
    label: "標題階層不硬塞 H3",
    defaultText: "標題階層依內容需要決定：H1→H2 兩層就能清楚表達時，不要硬拆出 H3；只有某個主題底下真的有多個子主題時才用 H3",
    toggleable: true,
    editable: true,
  },
  {
    id: "R7",
    section: "rag",
    group: "結構",
    label: "條列完整句",
    defaultText: "條列的每一點都要是能單獨看懂的完整句子（講清楚主詞與結論），不要只寫名詞片語；也不要把本來該條列的多個要點擠成一大段長文",
    toggleable: true,
    editable: true,
  },
  {
    id: "R8",
    section: "rag",
    group: "結構",
    label: "圖片資訊轉文字",
    defaultText:
      "圖片、示意圖、圖示裡的資訊（例如 ✓／✗ 正確與錯誤做法對照圖、流程圖、尺寸標示圖）都要轉寫成文字敘述放進正文，不能略過，也不要寫「如圖所示」這種依賴圖片的說法",
    toggleable: true,
    editable: true,
  },
  {
    id: "R9",
    section: "rag",
    group: "結構",
    label: "段落自足",
    defaultText: "段落要自足，禁止「如上所述」「上述」「同前條」「詳見前頁」這種依賴上下文才成立的指代寫法——每個段落/條列都要重新把具體內容講一次，不能只回指前面",
    toggleable: true,
    editable: true,
  },
  {
    id: "R10",
    section: "rag",
    group: "結構",
    label: "移除雜訊",
    defaultText:
      "移除頁首、頁尾、頁碼這類跟內容本身無關的雜訊；如果原始內容是網頁，額外要濾掉導覽列、相關文章推薦、留言區、cookie 同意條這類非正文的爬蟲雜訊",
    toggleable: true,
    editable: true,
  },
  {
    id: "R11",
    section: "rag",
    group: "結構",
    label: "保留原文",
    defaultText: "保留文件原本的資訊與用詞，不要摘要、不要省略、不要改寫語意，只整理格式、結構與寫法",
    toggleable: true,
    editable: true,
    presets: [
      { label: "完整保留（預設）", text: "保留文件原本的資訊與用詞，不要摘要、不要省略、不要改寫語意，只整理格式、結構與寫法" },
      { label: "允許精簡", text: "保留文件的所有關鍵資訊（數字、條件、步驟、例外），但可以精簡重複或冗長的敘述，讓內容更易讀" },
    ],
  },
  {
    id: "R12",
    section: "rag",
    group: "可單獨切塊",
    label: "段首主題句",
    defaultText:
      "每個標題底下的內容一開始，都要有一句肉眼可見的完整句子，明講「這段在講哪個品牌/文件/主題」，例如「以下說明追覓吹風機的保固與維修政策」。不是隱藏的 metadata，是正常寫在內文裡的一句話——這樣即使下游系統把文件切成任意大小的片段，不管切到哪一塊，只要涵蓋到段落開頭附近，都能看出這段在講什麼",
    toggleable: true,
    editable: true,
  },
  {
    id: "R13",
    section: "rag",
    group: "可單獨切塊",
    label: "絕對值",
    defaultText: "時間、金額、規格數字寫絕對值：原文有給明確日期就換算寫死，不要保留「即日起」「目前」這種相對說法；原文沒給日期就照實保留，不要自己編一個日期",
    toggleable: true,
    editable: true,
  },
  {
    id: "R14",
    section: "rag",
    group: "可單獨切塊",
    label: "範圍與例外同段",
    defaultText: "適用範圍與例外要跟結論寫在同一段裡，不要拆到別段或省略（例如「僅限 A、B 機種，C 機種不適用」要跟前面的結論放在一起）",
    toggleable: true,
    editable: true,
  },
  {
    id: "R15",
    section: "rag",
    group: "可單獨切塊",
    label: "單一事實來源",
    defaultText:
      "同一個具體數字/規格值只在它第一次出現、最適合的那個段落講清楚一次；如果後面其他段落需要再提到同一件事，用文字描述帶過（例如「超出前面提到的身高範圍時」），不要把同一個數字原封不動再重複打一次，**用括號補註數字也算重複**（例如「前面提到的適用身高範圍（145-200 公分）」就是違規）——同一個事實只有一個地方是最終依據，避免之後修改內容時只改到其中一處、造成兩處數字兜不起來",
    toggleable: true,
    editable: true,
  },
  {
    id: "R16",
    section: "rag",
    group: "表格",
    label: "表格攤平成句子",
    defaultText: "保留成 markdown table 的同時，額外在旁邊補一段把表格內容攤平成完整句子的敘述（例如「A方案月租299元，含10GB流量」），因為下游系統可能連表格的欄位對應語意都解析不好",
    toggleable: true,
    editable: true,
  },
  {
    id: "R17",
    section: "rag",
    group: "輸出前檢查",
    label: "輸出前自我檢查",
    defaultText:
      "輸出前請逐段自我檢查一次：正文裡每一個具體數字/規格值是否只出現一次（「文件資訊」「本文回答哪些問題」「常見說法對照」這三個開頭區塊不算）；第二次以後出現的，一律改成文字描述（例如「前面提到的適用身高範圍」），連括號補註都要拿掉。",
    toggleable: true,
    editable: true,
    dependsOn: "R15",
  },
  {
    id: "R18",
    section: "rag",
    group: "輸出格式",
    label: "直接輸出 markdown",
    defaultText:
      "直接輸出整理後的 markdown 全文，不要加開場白或結語，也不要用 json 區塊包起來。即使你需要先用工具讀取網頁內容，讀取完成後也要直接接著輸出整理後的 markdown 本文，不要加「好的」「以下是」「整理完成」這類過渡句或任何說明你正在做什麼的句子——你的完整回應從第一個字開始就必須是文件本身的內容（例如一個標題），不能是任何其他文字。",
    toggleable: false,
    editable: false,
  },

  // ---------------- AI 比對 ----------------
  {
    id: "judge.intro",
    section: "judge",
    group: "角色與任務",
    label: "角色說明",
    defaultText: "你是客服知識庫的品質檢查員。使用者會給你一題客服問題、標準答案，以及客服機器人的實際回答。\n請判斷機器人回答跟標準答案是否一致：",
    toggleable: false,
    editable: true,
  },
  {
    id: "J1",
    section: "judge",
    group: "判斷標準",
    label: "比對重點",
    defaultText: "重點是「意思」與「關鍵資訊」（數字、條件、步驟、限制、注意事項），用字、語氣、排版、順序不同都不算不一致。",
    toggleable: false,
    editable: true,
    presets: [
      { label: "標準（預設）", text: "重點是「意思」與「關鍵資訊」（數字、條件、步驟、限制、注意事項），用字、語氣、排版、順序不同都不算不一致。" },
      { label: "寬鬆", text: "只要主要意思正確就算一致；次要細節有出入、或少講了非關鍵的補充說明，都不算不一致。" },
      { label: "嚴格", text: "數字、條件、步驟、限制、注意事項必須逐項一致，少任何一項或任何一個數字不同就算不一致；用字與語氣不同不算。" },
    ],
  },
  {
    id: "J2",
    section: "judge",
    group: "判斷標準",
    label: "多補充仍算一致",
    defaultText: "機器人多補充了不衝突的資訊，只要標準答案的關鍵資訊都有講到、沒有講錯，仍算一致。",
    toggleable: true,
    editable: true,
  },
  {
    id: "J3",
    section: "judge",
    group: "判斷標準",
    label: "不一致的情況",
    defaultText: "以下算不一致：漏掉標準答案裡的關鍵資訊、數字或條件講錯、意思相反或答非所問、回答「不知道」或要客戶另洽客服。",
    toggleable: true,
    editable: true,
  },
  {
    id: "J4",
    section: "judge",
    group: "判斷標準",
    label: "說明差異",
    defaultText: "不一致時，reason 用繁體中文一到兩句具體說明差異（例如「少回答到保固期限 2 年」「把 100 公分講成 120 公分」）；一致時 reason 填空字串。",
    toggleable: false,
    editable: true,
  },
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

export const SECTION_LABELS: Record<PromptSection, string> = {
  faq: "FAQ 題組",
  doc: "結構化文件",
  rag: "RAG 內容",
  judge: "AI 比對",
};

export function ruleDef(id: string): RuleDef {
  const def = RULE_BY_ID.get(id);
  if (!def) throw new Error(`未知的提示詞規則：${id}`);
  return def;
}

// 規則最後生效的狀態：公司的覆蓋值優先，其次是預設；不可開關/不可編輯的部分一律用預設
export function resolveRule(config: PromptConfigData | undefined, id: string): { enabled: boolean; text: string } {
  const def = ruleDef(id);
  const override = config?.rules?.[id];
  let enabled = def.toggleable ? (override?.enabled ?? true) : true;
  if (enabled && def.dependsOn && !resolveRule(config, def.dependsOn).enabled) enabled = false;
  const text = def.editable && override?.text?.trim() ? override.text.trim() : def.defaultText;
  return { enabled, text };
}

export function ruleText(config: PromptConfigData | undefined, id: string): string | null {
  const r = resolveRule(config, id);
  return r.enabled ? r.text : null;
}

export function resolveOptions(config: PromptConfigData | undefined): PromptOptions {
  const o = config?.options ?? {};
  const min = Number.isFinite(o.faqCountMin) && (o.faqCountMin ?? 0) >= 1 ? Math.floor(o.faqCountMin!) : DEFAULT_OPTIONS.faqCountMin;
  const maxRaw = Number.isFinite(o.faqCountMax) ? Math.floor(o.faqCountMax!) : DEFAULT_OPTIONS.faqCountMax;
  return {
    faqCountMin: min,
    faqCountMax: Math.max(min, maxRaw),
    docMissingText: o.docMissingText?.trim() || DEFAULT_OPTIONS.docMissingText,
    docOverviewField: o.docOverviewField ?? DEFAULT_OPTIONS.docOverviewField,
    docSelfContainedHeadings: o.docSelfContainedHeadings ?? DEFAULT_OPTIONS.docSelfContainedHeadings,
    exportFrontmatter: o.exportFrontmatter ?? DEFAULT_OPTIONS.exportFrontmatter,
    exportGroupBy: (["tally", "source", "none"] as const).includes(o.exportGroupBy as never) ? o.exportGroupBy! : DEFAULT_OPTIONS.exportGroupBy,
    exportQuestionFormat: (["h3", "bold", "numbered"] as const).includes(o.exportQuestionFormat as never)
      ? o.exportQuestionFormat!
      : DEFAULT_OPTIONS.exportQuestionFormat,
    exportIncludeDocs: o.exportIncludeDocs ?? DEFAULT_OPTIONS.exportIncludeDocs,
  };
}

// 儲存前清理：只留認得的規則與選項，跟預設相同的值不存（之後預設更新時，沒改過的公司會自動跟上）
export function sanitizePromptConfig(input: unknown): PromptConfigData {
  const raw = (typeof input === "object" && input !== null ? input : {}) as PromptConfigData;
  const rules: Record<string, RuleOverride> = {};
  for (const [id, value] of Object.entries(raw.rules ?? {})) {
    const def = RULE_BY_ID.get(id);
    if (!def || typeof value !== "object" || value === null) continue;
    const entry: RuleOverride = {};
    if (def.toggleable && value.enabled === false) entry.enabled = false;
    if (def.editable && typeof value.text === "string") {
      const text = value.text.trim().slice(0, 4000);
      if (text && text !== def.defaultText) entry.text = text;
    }
    if (Object.keys(entry).length > 0) rules[id] = entry;
  }

  const options: Partial<PromptOptions> = {};
  const resolved = resolveOptions({ options: raw.options });
  for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof PromptOptions)[]) {
    if (resolved[key] !== DEFAULT_OPTIONS[key]) (options as Record<string, unknown>)[key] = resolved[key];
  }
  return { rules, options };
}
