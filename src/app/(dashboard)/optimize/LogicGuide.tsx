"use client";

import { useState } from "react";
import { Modal } from "./optimizeShared";

// 自動優化頁標題旁的「邏輯說明」：點開是整個流程的圖文說明（內容要跟 src/lib/optimizationRunner.ts 的實際邏輯一致）

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function Arrow({ vertical }: { vertical?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-slate-300 ${vertical ? "rotate-90 sm:rotate-0" : ""}`} aria-hidden>
      <path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STEP_COLORS = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
} as const;

function FlowBox({ no, title, sub, color }: { no: string; title: string; sub: string; color: keyof typeof STEP_COLORS }) {
  return (
    <div className={`flex-1 rounded-xl px-3 py-2.5 text-center ring-1 ring-inset ${STEP_COLORS[color]}`}>
      <p className="text-sm font-semibold">
        {no} {title}
      </p>
      <p className="mt-0.5 text-[11px] opacity-80">{sub}</p>
    </div>
  );
}

function Section({ no, title, color, children }: { no: string; title: string; color: keyof typeof STEP_COLORS; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ring-1 ring-inset ${STEP_COLORS[color]}`}>{no}</span>
        {title}
      </h3>
      <div className="space-y-2 text-[13px] leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Pill({ tone, children }: { tone: "green" | "lime" | "rose" | "slate"; children: React.ReactNode }) {
  const cls = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    lime: "bg-amber-50 text-amber-700 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  }[tone];
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>{children}</span>;
}

function GuideContent() {
  return (
    <div className="space-y-5">
      {/* 總覽流程圖 */}
      <section className="rounded-2xl bg-gradient-to-br from-slate-50 to-teal-50/60 p-4 ring-1 ring-inset ring-slate-200">
        <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500">整體流程</p>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <FlowBox no="①" title="準備" sub="第一版 md＋題目" color="slate" />
          <Arrow vertical />
          <FlowBox no="②" title="上傳＋學習" sub="換掉後台上一版" color="sky" />
          <Arrow vertical />
          <FlowBox no="③" title="測試＋比對" sub="問機器人、錯題重問、算分" color="amber" />
          <Arrow vertical />
          <div className="flex-1 rounded-xl bg-white px-3 py-2.5 text-center ring-1 ring-inset ring-slate-200">
            <p className="text-sm font-semibold text-slate-700">要停嗎？</p>
            <p className="mt-0.5 text-[11px] text-slate-500">達標／跑滿／沒進步 → 結束</p>
          </div>
        </div>
        {/* 回圈 */}
        <div className="mt-2 flex items-center gap-2 sm:pl-[25%]">
          {/* 從 ④ 往上指回 ② */}
          <svg viewBox="0 0 40 28" className="hidden h-7 w-10 shrink-0 text-violet-400 sm:block" aria-hidden>
            <path d="M38 20H14a6 6 0 0 1-6-6V3M3 8l5-5 5 5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="flex-1 rounded-xl px-3 py-2 text-center ring-1 ring-inset ring-violet-200 bg-violet-50 text-violet-700">
            <p className="text-sm font-semibold">④ AI 修改 md</p>
            <p className="mt-0.5 text-[11px] opacity-80">沒有要停 → 從最高分版本修改，產生新版本，回到 ②</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          每一輪都存成一個版本（v第幾次任務.第幾輪），留下 md、分數、逐題結果與修改紀錄。任務在伺服器上跑，關掉電腦也不影響；全公司一次只能跑一個任務。
        </p>
      </section>

      <Section no="①" title="準備（只在第一輪前做一次）" color="slate">
        <Bullets
          items={[
            <>
              <b>md：</b>把範圍內的 FAQ 或結構化文件組成第一版。
            </>,
            <>
              <b>題目：</b>範圍內的 FAQ，或公司的固定測試題庫。
            </>,
            <>
              <b>相似題：</b>AI 為每題產生 N 個不同問法（答案相同），用來確認機器人真的懂，不是只會背原題。
            </>,
            <>
              題目定下來後<b>每一輪都用同一套</b>，分數才能互相比較。
            </>,
          ]}
        />
      </Section>

      <Section no="②" title="上傳＋學習" color="sky">
        <ol className="grid gap-2 sm:grid-cols-5">
          {[
            ["刪掉上一版", "只刪 AIBPO 上傳過的，不碰後台原有知識"],
            ["上傳 md", "結構化文件一個 H1 一個檔；所有機器人共用同一個知識庫"],
            ["呼叫學習", "等後台顯示「已學習」"],
            ["等滿 N 分鐘", "從呼叫學習 API 那一刻起算"],
            ["試問第一題", "有回答才開始測；沒回答再等 N 分鐘重試"],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-xl bg-sky-50/60 p-2.5 ring-1 ring-inset ring-sky-100">
              <p className="text-xs font-semibold text-sky-800">
                {i + 1}. {t}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section no="③" title="測試＋比對＋算分" color="amber">
        <p>每題用全新的對話問機器人（原題＋相似題），再由 AI 比對。<b>第一次沒答對的題目會再問一次，第二次答對就算對</b>：機器人每次回答都不太一樣，這樣可以降低偶爾答壞造成的起伏，AI 也不會去修只是剛好答壞的題目。比對分三步：</p>
        {/* 比對圖解 */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <p className="mb-2 text-xs font-semibold text-slate-700">1. 標準答案拆成關鍵答案</p>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-1.5">
                <Pill tone="slate">必要</Pill>保固 1 年
              </div>
              <div className="flex items-center gap-1.5">
                <Pill tone="slate">必要</Pill>需附購買憑證
              </div>
              <div className="flex items-center gap-1.5">
                <Pill tone="slate">次要</Pill>可線上登錄
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">固定用 Sonnet，每個標準答案只拆一次，之後都用同一組；可以手動修改。</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <p className="mb-2 text-xs font-semibold text-slate-700">2. 逐點檢查機器人回答</p>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-emerald-600">✓</span>講到（引用原句）
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-400">○</span>沒講到
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-rose-600">✗</span>講錯（數字、條件、對象不同）
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-rose-600">!</span>多講且跟標準答案矛盾
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">矛盾一定要引用標準答案裡被推翻的原句；標準答案沒提到的補充、沒講到、不完整都不算矛盾。比對模型選 Haiku 時，判出講錯或矛盾的題目會再由 Sonnet 複核。</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <p className="mb-2 text-xs font-semibold text-slate-700">3. 由程式決定結果</p>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-start gap-1.5">
                <Pill tone="green">一致</Pill>必要點全講到，沒錯、沒矛盾
              </div>
              <div className="flex items-start gap-1.5">
                <Pill tone="lime">部分一致</Pill>沒講錯，但必要點沒講全
              </div>
              <div className="flex items-start gap-1.5">
                <Pill tone="rose">不一致</Pill>講錯、矛盾，或完全沒講到
              </div>
              <div className="flex items-start gap-1.5">
                <Pill tone="slate">未回答</Pill>逾時或出錯
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-amber-50/60 px-3 py-2 text-xs ring-1 ring-inset ring-amber-100">
          <span className="font-semibold text-amber-800">正確率</span>
          <span>
            <Pill tone="green">一致</Pill> ＋ <Pill tone="lime">部分一致</Pill> 算對
          </span>
          <span className="text-slate-500">另外算原題、相似題正確率與涵蓋率（平均講到幾成關鍵答案）</span>
        </div>
        <p className="pt-1 font-medium text-slate-700">要不要停？任一成立就結束：</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ["🎯", "達到目標正確率"],
            ["🔁", "跑滿最多輪數"],
            ["⏸", "連續 N 輪沒超過目前最高分"],
          ].map(([icon, t]) => (
            <div key={t} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs ring-1 ring-inset ring-slate-200">
              <span className="text-base">{icon}</span>
              {t}
            </div>
          ))}
        </div>
      </Section>

      <Section no="④" title="AI 修改 md" color="violet">
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {[
            ["最高分版本", "退步的版本不疊加修改"],
            ["挑要修的題目", "一輪最多 20 題"],
            ["AI 診斷原因", "讀來源檔案、md 與分類管理"],
            ["局部修改", "分兩批，各 10 題"],
            ["新版本", "附修改紀錄，回到 ②"],
          ].map(([t, d], i, all) => (
            <div key={t} className="flex flex-1 items-center gap-2">
              <div className="flex-1 rounded-xl bg-violet-50/70 px-2.5 py-2 text-center ring-1 ring-inset ring-violet-100">
                <p className="text-xs font-semibold text-violet-800">{t}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{d}</p>
              </div>
              {i < all.length - 1 && <Arrow vertical />}
            </div>
          ))}
        </div>
        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 font-medium text-slate-700">哪些題目會拿去修？</p>
            <Bullets
              items={[
                "原題中結果不是「一致」的（部分一致也會補強）",
                "相似題不給 AI 看，只當驗收，避免照題目背答案",
                "之前判定「原文就沒有」的題目不再處理",
                "寫了備註的題目一定處理（包含已經一致的）",
                "之前幾輪改過但還沒答對的題目，會附上當時的診斷和改法，請 AI 換一種做法",
              ]}
            />
            <p className="mb-1.5 mt-3 font-medium text-slate-700">依分類管理放對位置</p>
            <Bullets
              items={[
                "AI 會拿到分類管理的分類樹與說明，補充的內容要放進最符合的段落（例如保養方式放清潔保養、故障處理放維修排障）",
                "分類層級的標題（結構化文件的 # 項目、## 維度、### 子維度）由程式保護：新增、改名或刪除這些標題的修改不會套用，會在修改說明標示原因",
              ]}
            />
          </div>
          <div>
            <p className="mb-1.5 font-medium text-slate-700">優先順序（超過 20 題留到下一輪）</p>
            <div className="space-y-1">
              {["有備註且沒答對", "講錯／矛盾", "沒答對", "有備註但已一致", "部分一致"].map((t, i) => (
                <div key={t} className="flex items-center gap-2 text-xs">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">{i + 1}</span>
                  <span className="rounded-lg bg-white px-2 py-1 ring-1 ring-inset ring-slate-200" style={{ width: `${100 - i * 12}%` }}>
                    {t}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-slate-400">同一級再比必要點漏了幾個；已經試過還沒改好的題目稍微往後排，讓從沒處理過的錯題也輪得到。</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-violet-50/60 px-3 py-2 text-xs text-violet-900 ring-1 ring-inset ring-violet-100">
          第二批接著第一批改好的 md 修改；某一批輸出太長會減半重試，第二批失敗時保留第一批的修改。修改內容一定要有來源原始檔案當根據；你的備註只當方向，原文沒有的內容不會被寫進 md（會標成「原文沒有」）。局部修改一項都套不上時，才退回整份重寫。
        </div>
      </Section>

      <Section no="★" title="其他功能" color="teal">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ["從某版繼續", "開新任務，沿用那一版的 md、同一套題目和備註；已測過就直接從修改開始。請從分數最高的版本繼續。"],
            ["重新比對", "用存好的機器人回答，依目前的比對規則重判並重算分數；不重問機器人、不需要 token。"],
            ["部署到後台", "把選定的版本正式放上後台知識庫。"],
            ["寫備註", "在逐題結果寫給 AI 的修改方向，下一次修改優先處理。"],
            ["token", "只放在伺服器記憶體、不存資料庫；有 refresh token 會自動換新，沒有或伺服器重啟就暫停，貼新的 token 從中斷那一步繼續。"],
            ["停止與繼續", "只有按「停止」（會先確認）才會停止，卡片會記下誰在什麼時候按的。暫停、失敗或停止的任務都可以「貼 token 繼續」，從中斷的那一步接著跑（公司沒有別的任務在跑時）。"],
            ["下載診斷資料", "匯出各版本分數、逐題結果、修改紀錄與 md，用來分析分數變化。"],
            ["LINE 通知", "任務完成、失敗、暫停等 token 或被停止時，通知公司綁定的 LINE 群組；在「參數管理 → LINE 通知」設定。"],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl bg-teal-50/40 p-3 ring-1 ring-inset ring-teal-100">
              <p className="text-xs font-semibold text-teal-800">{t}</p>
              <p className="mt-1 text-[12px] leading-snug text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <section className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-100">
        <p className="mb-1 font-semibold">看分數的小提醒</p>
        <Bullets
          items={[
            "機器人每次回答都不太一樣，同一份 md 測兩次也可能差幾個百分點（錯題重問已經降低這個影響）；小幅起伏不一定是改壞了。",
            "比對規則改過之後，舊版本可以按「重新比對」用新規則重判，分數才能跟新版本比較。",
            "想知道某一版到底改了什麼、改好或改壞哪些題，可以勾兩個版本「比較」，或看「修改說明」。",
          ]}
        />
      </section>
    </div>
  );
}

export function LogicGuide() {
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
        <Modal title="自動優化的邏輯說明" onClose={() => setOpen(false)} wide>
          <GuideContent />
        </Modal>
      )}
    </>
  );
}
