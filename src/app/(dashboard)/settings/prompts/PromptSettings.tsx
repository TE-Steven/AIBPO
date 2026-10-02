"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RULES,
  SECTION_LABELS,
  DEFAULT_OPTIONS,
  resolveRule,
  resolveOptions,
  type PromptConfigData,
  type PromptOptions,
  type PromptSection,
  type RuleDef,
} from "@/lib/promptConfig";
import {
  buildSystemPrompt,
  buildDocumentsSystemPrompt,
  buildRagSystemPrompt,
  buildJudgeSystemPrompt,
  buildKeyPointsSystemPrompt,
} from "@/lib/kmAnalysis";
import { buildRevisionSystemPrompt, buildSimilarQuestionsSystemPrompt } from "@/lib/optimizationPrompts";
import { buildTallyTree, tallyTemplates } from "@/lib/tallyTree";
import type { Tally } from "@/generated/prisma/client";
import { savePromptConfigAction } from "./actions";
import { PromptForm } from "./PromptForm";
import { IconAlertTriangle, IconCheckCircle, IconChevronDown, IconLock } from "@/components/icons";

type Tab = "guidelines" | PromptSection | "options";

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: "guidelines", label: "最高準則", desc: "放在每一份提示詞的最前面，優先於其他所有規則。" },
  { id: "faq", label: SECTION_LABELS.faq, desc: "來源頁「開始分析」產生 FAQ 時使用。" },
  { id: "doc", label: SECTION_LABELS.doc, desc: "依分類範本產生結構化文件時使用（分析時勾選 Tally，或來源頁重新產生）。" },
  { id: "rag", label: SECTION_LABELS.rag, desc: "來源頁「產生 RAG 內容」時使用，對應 .md 的 12 項檢核。" },
  { id: "judge", label: SECTION_LABELS.judge, desc: "機器人測試時，AI 先把標準答案拆成關鍵答案，再逐點檢查機器人回答；是否算一致的門檻在「數值與匯出」分頁的比對規則。" },
  { id: "optimize", label: SECTION_LABELS.optimize, desc: "自動優化時，AI 依答錯的題目修改 md、以及產生相似題的規則。" },
  { id: "options", label: "數值與匯出", desc: "FAQ 題數預設、結構化文件顯示方式、知識列表匯出格式、機器人測試的比對規則。" },
];

// 預覽用的示意資料
function sampleTemplates() {
  const b = { roleId: "", description: null, createdAt: new Date(0), updatedAt: new Date(0) };
  return tallyTemplates(
    buildTallyTree<Tally>([
      { id: "p", name: "產品型號", parentId: null, order: 1, ...b },
      { id: "p1", name: "價格", parentId: "p", order: 1, ...b },
      { id: "p2", name: "安裝需求", parentId: "p", order: 2, ...b },
      { id: "p21", name: "安裝高度", parentId: "p2", order: 1, ...b },
    ]),
  );
}

function buildPreview(section: PromptSection, config: PromptConfigData, guidelines: string): string {
  const options = resolveOptions(config);
  switch (section) {
    case "faq":
      return buildSystemPrompt({
        dimensions: ["（分析時選的維度）"],
        tallyPaths: ["（分類完整路徑，例：產品型號 > 價格）"],
        countMin: options.faqCountMin,
        countMax: options.faqCountMax,
        answerStyle: "（分析時填的答案輸出風格）",
        guidelines,
        config,
      });
    case "doc":
      return buildDocumentsSystemPrompt({ templates: sampleTemplates(), guidelines, config });
    case "rag":
      return buildRagSystemPrompt({ docId: "（來源 ID）", sourceDescription: "PDF 上傳", guidelines, config });
    case "judge":
      return `【拆關鍵答案的提示詞（每個標準答案只拆一次）】

${buildKeyPointsSystemPrompt(config)}


【逐點比對的提示詞（最後是否一致由系統依「數值與匯出」分頁的比對規則計算）】

${buildJudgeSystemPrompt(config)}`;
    case "optimize":
      return `【修改 md 的提示詞】

${buildRevisionSystemPrompt({ guidelines, config })}


【產生相似題的提示詞】

${buildSimilarQuestionsSystemPrompt({ count: 3, config })}`;
  }
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-100 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-teal-600" : "bg-slate-300"
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

function isRuleId(id: string) {
  return /^[A-Z]+\d+$/.test(id);
}

function RuleCard({
  def,
  config,
  onChange,
}: {
  def: RuleDef;
  config: PromptConfigData;
  onChange: (id: string, patch: { enabled?: boolean; text?: string } | null) => void;
}) {
  const override = config.rules?.[def.id];
  const resolved = resolveRule(config, def.id);
  const ownEnabled = def.toggleable ? (override?.enabled ?? true) : true;
  const parentOff = Boolean(def.dependsOn && !resolveRule(config, def.dependsOn).enabled);
  const text = override?.text ?? def.defaultText;
  const modified = (def.toggleable && override?.enabled === false) || (def.editable && override?.text !== undefined && override.text !== def.defaultText);

  return (
    <div className={`rounded-lg border bg-white p-4 transition ${resolved.enabled ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {isRuleId(def.id) && (
          <span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-teal-700">{def.id}</span>
        )}
        <span className="text-sm font-semibold text-slate-800">{def.label}</span>
        {!def.editable && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            <IconLock className="h-3 w-3" />
            系統固定
          </span>
        )}
        {modified && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">已修改</span>}
        <div className="ml-auto flex items-center gap-3">
          {modified && (
            <button type="button" onClick={() => onChange(def.id, null)} className="text-xs font-medium text-slate-500 hover:text-teal-600">
              還原預設
            </button>
          )}
          {def.toggleable && (
            <Toggle
              checked={ownEnabled}
              disabled={parentOff}
              onChange={(v) => onChange(def.id, { enabled: v })}
              label={`${ownEnabled ? "關閉" : "開啟"} ${def.label}`}
            />
          )}
        </div>
      </div>
      {def.hint && <p className="mt-1 text-xs text-slate-500">{def.hint}</p>}
      {parentOff && <p className="mt-1 text-xs text-amber-600">要先開啟 {def.dependsOn} 才會生效。</p>}
      {def.editable ? (
        <textarea
          id={`rule-${def.id}`}
          value={text}
          disabled={!resolved.enabled}
          onChange={(e) => onChange(def.id, { text: e.target.value })}
          rows={Math.min(8, Math.max(2, Math.ceil(text.length / 70) + (text.match(/\n/g)?.length ?? 0)))}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-400"
        />
      ) : (
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">{def.defaultText}</p>
      )}
      {def.presets && resolved.enabled && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">快速套用：</span>
          {def.presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(def.id, { text: p.text })}
              className={`rounded-full border px-2.5 py-1 font-medium transition ${
                text === p.text ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100";

export function PromptSettings({ guidelines, initialConfig }: { guidelines: string; initialConfig: PromptConfigData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("faq");
  const [saved, setSaved] = useState<PromptConfigData>(initialConfig);
  const [draft, setDraft] = useState<PromptConfigData>(initialConfig);
  const [message, setMessage] = useState<{ success?: string; error?: string }>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, startSave] = useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const options = resolveOptions(draft);

  function changeRule(id: string, patch: { enabled?: boolean; text?: string } | null) {
    setMessage({});
    setDraft((prev) => {
      const rules = { ...(prev.rules ?? {}) };
      if (patch === null) delete rules[id];
      else rules[id] = { ...rules[id], ...patch };
      return { ...prev, rules };
    });
  }

  function changeOption<K extends keyof PromptOptions>(key: K, value: PromptOptions[K]) {
    setMessage({});
    setDraft((prev) => ({ ...prev, options: { ...(prev.options ?? {}), [key]: value } }));
  }

  function save() {
    startSave(async () => {
      const result = await savePromptConfigAction(draft);
      setMessage(result);
      if (result.config) {
        setSaved(result.config);
        setDraft(result.config);
        router.refresh();
      }
    });
  }

  function resetSection(section: PromptSection) {
    setMessage({});
    setDraft((prev) => {
      const rules = { ...(prev.rules ?? {}) };
      for (const r of RULES) if (r.section === section) delete rules[r.id];
      return { ...prev, rules };
    });
  }

  const modifiedCount = (section: PromptSection) => RULES.filter((r) => r.section === section && draft.rules?.[r.id]).length;
  const sectionRules = (section: PromptSection) => RULES.filter((r) => r.section === section);
  const preview = useMemo(
    () => (tab !== "guidelines" && tab !== "options" ? buildPreview(tab, draft, guidelines) : ""),
    [tab, draft, guidelines],
  );

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-4 pb-20">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {TABS.map((t) => {
          const count = t.id !== "guidelines" && t.id !== "options" ? modifiedCount(t.id) : 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setPreviewOpen(false);
              }}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.id ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
              {count > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">{count}</span>}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-slate-500">{current.desc}</p>

      {tab === "guidelines" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">KM 輸出最高準則</h2>
          <PromptForm defaultValue={guidelines} />
        </div>
      )}

      {tab !== "guidelines" && tab !== "options" && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>
              共 {sectionRules(tab).length} 段，開關可決定這段要不要放進提示詞，文字可以直接修改；「系統固定」的部分是程式解析需要，不能修改。
            </span>
            {modifiedCount(tab) > 0 && (
              <button type="button" onClick={() => resetSection(tab)} className="ml-auto font-medium text-slate-500 hover:text-teal-600">
                這一頁全部還原預設
              </button>
            )}
          </div>
          {Array.from(new Set(sectionRules(tab).map((r) => r.group))).map((group) => (
            <div key={group} className="space-y-2">
              <h3 className="pt-2 text-xs font-bold tracking-wider text-slate-400">{group}</h3>
              {sectionRules(tab)
                .filter((r) => r.group === group)
                .map((def) => (
                  <RuleCard key={def.id} def={def} config={draft} onChange={changeRule} />
                ))}
            </div>
          ))}

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-slate-800"
            >
              預覽完整提示詞（含尚未儲存的修改）
              <IconChevronDown className={`h-4 w-4 transition-transform ${previewOpen ? "rotate-180" : ""}`} />
            </button>
            {previewOpen && (
              <div className="border-t border-slate-100 px-5 py-4">
                <p className="mb-2 text-xs text-slate-500">括號內的「（…）」是執行時才會代入的內容，這裡用示意文字表示。</p>
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700">
                  {preview}
                </pre>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "options" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-2 shadow-sm">
            <h3 className="pt-3 text-xs font-bold tracking-wider text-slate-400">機器人測試比對規則</h3>
            <OptionRow
              label="一致的條件"
              hint="必要的關鍵答案一定要全部講到；次要的可以不講。設成 0 就只看必要點，設成 80 表示所有關鍵答案還要講到 8 成以上。"
            >
              <div className="flex items-center gap-2 text-sm">
                整體涵蓋率至少
                <input
                  id="opt-judge-coverage"
                  type="number"
                  min={0}
                  max={100}
                  value={options.judgeMinCoverage}
                  onChange={(e) => changeOption("judgeMinCoverage", Number(e.target.value) || 0)}
                  className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                %
              </div>
            </OptionRow>
            <OptionRow label="講錯的容忍度" hint="講錯包括數字、條件講錯，以及多講了跟標準答案衝突的內容。">
              <select
                id="opt-judge-wrong"
                value={options.judgeWrongTolerance}
                onChange={(e) => changeOption("judgeWrongTolerance", e.target.value as PromptOptions["judgeWrongTolerance"])}
                className={selectClass}
              >
                <option value="any">任何一點講錯都不一致</option>
                <option value="requiredOnly">只有必要點講錯才不一致</option>
              </select>
            </OptionRow>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-2 shadow-sm">
            <h3 className="pt-3 text-xs font-bold tracking-wider text-slate-400">FAQ</h3>
            <OptionRow label="FAQ 題數預設（F7）" hint="「開始分析」時題數欄位的預設值，分析當下仍可調整。">
              <div className="flex items-center gap-2 text-sm">
                <input
                  id="opt-faq-min"
                  type="number"
                  min={1}
                  value={options.faqCountMin}
                  onChange={(e) => changeOption("faqCountMin", Number(e.target.value) || 1)}
                  className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                ~
                <input
                  id="opt-faq-max"
                  type="number"
                  min={1}
                  value={options.faqCountMax}
                  onChange={(e) => changeOption("faqCountMax", Number(e.target.value) || 1)}
                  className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                題
              </div>
            </OptionRow>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-5 py-2 shadow-sm">
            <h3 className="pt-3 text-xs font-bold tracking-wider text-slate-400">結構化文件</h3>
            <OptionRow label="缺漏欄位顯示文字（DP1）" hint="文件沒寫到某個維度時，那一格顯示的文字。">
              <input
                id="opt-missing-text"
                type="text"
                value={draft.options?.docMissingText ?? DEFAULT_OPTIONS.docMissingText}
                onChange={(e) => changeOption("docMissingText", e.target.value)}
                className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </OptionRow>
            <OptionRow label="「補充說明」欄位（DP5）" hint="有子維度的維度，另外讓 AI 寫放不進子欄位的資訊。">
              <Toggle checked={options.docOverviewField} onChange={(v) => changeOption("docOverviewField", v)} label="補充說明欄位" />
            </OptionRow>
            <OptionRow label="整份下載的標題帶項目名稱" hint="「價格」寫成「L600｜價格」，餵 RAG 切塊後仍看得出是哪個項目（對應 R5／R12）。">
              <Toggle
                checked={options.docSelfContainedHeadings}
                onChange={(v) => changeOption("docSelfContainedHeadings", v)}
                label="整份下載的標題帶項目名稱"
              />
            </OptionRow>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-5 py-2 shadow-sm">
            <h3 className="pt-3 text-xs font-bold tracking-wider text-slate-400">知識列表匯出（.md / PDF）</h3>
            <OptionRow label="分組方式（E2）">
              <select
                id="opt-group-by"
                value={options.exportGroupBy}
                onChange={(e) => changeOption("exportGroupBy", e.target.value as PromptOptions["exportGroupBy"])}
                className={selectClass}
              >
                <option value="tally">依分類</option>
                <option value="source">依來源</option>
                <option value="none">不分組</option>
              </select>
            </OptionRow>
            <OptionRow label="FAQ 題目格式（E3）">
              <select
                id="opt-question-format"
                value={options.exportQuestionFormat}
                onChange={(e) => changeOption("exportQuestionFormat", e.target.value as PromptOptions["exportQuestionFormat"])}
                className={selectClass}
              >
                <option value="h3">標題「Q: 題目」</option>
                <option value="numbered">標題「1. 題目」</option>
                <option value="bold">粗體「Q：題目」</option>
              </select>
            </OptionRow>
            <OptionRow label="包含結構化文件（E5）">
              <Toggle checked={options.exportIncludeDocs} onChange={(v) => changeOption("exportIncludeDocs", v)} label="匯出包含結構化文件" />
            </OptionRow>
            <OptionRow label=".md 開頭 frontmatter（E1）" hint="exported_at、count，給下游程式讀；PDF 不受影響。">
              <Toggle checked={options.exportFrontmatter} onChange={(v) => changeOption("exportFrontmatter", v)} label=".md frontmatter" />
            </OptionRow>
          </div>
        </div>
      )}

      {tab !== "guidelines" && (dirty || message.success || message.error) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}>
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            {message.error ? (
              <span className="flex items-center gap-1.5 text-sm text-rose-600">
                <IconAlertTriangle className="h-4 w-4" />
                {message.error}
              </span>
            ) : message.success && !dirty ? (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                <IconCheckCircle className="h-4 w-4" />
                {message.success}
              </span>
            ) : (
              <span className="text-sm text-slate-600">有尚未儲存的修改（所有分頁一起儲存）</span>
            )}
            {dirty && (
              <div className="ml-auto flex items-center gap-3">
                <button type="button" onClick={() => setDraft(saved)} className="text-sm font-medium text-slate-500 hover:text-slate-700">
                  捨棄修改
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
                >
                  {saving ? "儲存中…" : "儲存設定"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
