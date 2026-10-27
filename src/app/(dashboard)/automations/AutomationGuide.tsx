"use client";

import { useState } from "react";
import { Modal } from "../optimize/optimizeShared";

// 自動化管理標題旁的「邏輯說明」（內容要跟 worker/capture.ts、worker/index.ts、src/lib/automationAnalysis.ts 的實際邏輯一致）

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 rotate-90 text-slate-300 sm:rotate-0" aria-hidden>
      <path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const COLORS = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
} as const;

function FlowBox({ no, title, sub, color }: { no: string; title: string; sub: string; color: keyof typeof COLORS }) {
  return (
    <div className={`flex-1 rounded-xl px-3 py-2.5 text-center ring-1 ring-inset ${COLORS[color]}`}>
      <p className="text-sm font-semibold">
        {no} {title}
      </p>
      <p className="mt-0.5 text-[11px] opacity-80">{sub}</p>
    </div>
  );
}

function Section({ no, title, color, items }: { no: string; title: string; color: keyof typeof COLORS; items: React.ReactNode[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ring-1 ring-inset ${COLORS[color]}`}>{no}</span>
        {title}
      </h3>
      <ul className="space-y-1.5 text-[13px] leading-relaxed text-slate-600">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GuideContent() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <FlowBox no="1" title="登記表單" sub="網址＋確認授權" color="slate" />
        <Arrow />
        <FlowBox no="2" title="瀏覽器打開" sub="背景 Worker 擷取頁面" color="sky" />
        <Arrow />
        <FlowBox no="3" title="AI 整理欄位" sub="Claude Sonnet 分析" color="violet" />
        <Arrow />
        <FlowBox no="4" title="人工確認" sub="修改欄位清單" color="amber" />
        <Arrow />
        <FlowBox no="5" title="產生 API" sub="下一階段開放" color="teal" />
      </div>

      <Section
        no="1"
        title="登記表單"
        color="slate"
        items={[
          "只能登記公司自己的表單，或已取得表單擁有者授權可以自動填寫的表單；登記時要勾選確認，系統會記錄是誰、什麼時間確認的。",
          "網址只接受 http / https 的公開網站。內部網路、本機、雲端主機內部位址（例如 localhost、10.x、192.168.x、169.254.x）一律擋掉，網址帶帳號密碼也不接受。",
          "登記後立刻排入一筆「分析」工作，由背景 Worker 處理，畫面會自動更新進度。",
        ]}
      />
      <Section
        no="2"
        title="瀏覽器打開表單（背景 Worker）"
        color="sky"
        items={[
          "Worker 是獨立的 Render 背景服務，用 Playwright（無頭 Chromium）打開表單，等頁面載入完成；網站服務本身不跑瀏覽器。",
          "頁面上每一個請求都會再檢查一次網址，表單頁面如果轉去內部網路位址會直接擋下。",
          "擷取四樣東西：頁面截圖、看得到的文字、所有輸入欄位（標籤、類型、必填、選項）、頁面自己載入的公開欄位設定資料（用來讓選項與必填判斷更準）。",
          "偵測到驗證碼（CAPTCHA）、需要輸入密碼的登入頁、信用卡欄位，會標成「不支援」並列出原因，不會嘗試繞過。",
          "Worker 每 3 秒檢查一次有沒有新工作；一筆工作卡在「分析中」超過 15 分鐘（例如 Worker 重新部署）會自動重新排隊。",
        ]}
      />
      <Section
        no="3"
        title="AI 整理欄位清單"
        color="violet"
        items={[
          "把截圖、頁面文字、欄位資訊交給 Claude Sonnet，整理成欄位清單：API 參數名稱（英文）、顯示名稱、類型、是否必填、可選值、格式限制、說明。",
          "類型有：文字、多行文字、數字、Email、電話、日期、時間、下拉選單、單選、勾選、多選、階層下拉（例如 品牌 > 型號）、檔案。",
          "每個欄位都會對應回頁面上實際的輸入框位置，之後代為填寫時用這個位置找欄位。",
          "AI 看不懂或有疑慮的地方（例如要先選某個選項才會出現的欄位）會寫在「AI 備註」，請人工確認。",
          "每次分析呼叫一次 Claude，費用約台幣數元；之後代為填寫送出不需要 AI。",
        ]}
      />
      <Section
        no="4"
        title="人工確認欄位清單"
        color="amber"
        items={[
          "可以修改：API 參數名稱、類型、必填、不讓 API 填、預設值、說明。顯示名稱與選項以頁面為準，不在這裡改。",
          "「不讓 API 填」的欄位不會出現在 API 裡，有預設值的話一律填預設值，適合用在內部欄位或固定值。",
          "API 參數名稱只能用小寫英文、數字、底線；儲存時會自動整理格式，重複的名稱會自動加上編號。",
          "表單改版後按「重新分析」，會用最新的頁面重新產生欄位清單（原本的修改會被覆蓋）。",
        ]}
      />
      <Section
        no="5"
        title="之後的階段"
        color="teal"
        items={[
          "產生 API：每張表單一支端點，用公司的 API Key 驗證；收到資料先依欄位清單檢查必填、類型、選項，不合格直接回錯誤，不會送出半套表單。附 API 文件（OpenAPI）。",
          "代為送出：Worker 用瀏覽器照欄位清單填寫、按送出、讀取結果頁的單號或成功訊息，留下截圖與執行紀錄；成功或失敗都會推 LINE 通知。",
          "串進 AI Agent：把表單 API 匯成 Skill，機器人在對話中收集好欄位後直接呼叫。",
        ]}
      />
    </div>
  );
}

export function AutomationGuide() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-50"
      >
        <InfoIcon className="h-3.5 w-3.5" />
        邏輯說明
      </button>
      {open && (
        <Modal title="自動化管理的邏輯說明" onClose={() => setOpen(false)} wide>
          <GuideContent />
        </Modal>
      )}
    </>
  );
}
