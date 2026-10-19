"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marked } from "marked";
import { getVersionMarkdownAction, saveVersionMarkdownAction, type OptimizeActionResult, type VersionMarkdownView } from "./actions";
import { Feedback, InfoTip } from "./optimizeShared";

// 預覽／修改某一版的 md：預覽依 H1 分段（可以跳到某一份文件）、編輯後儲存，下載按鈕在這裡

// md 轉 HTML：原文裡的 HTML 一律當文字顯示（避免執行內容裡的程式碼），連結只留 http(s)
function renderMarkdown(md: string): string {
  const html = marked.parse(md.replace(/</g, "&lt;"), { async: false }) as string;
  return html
    .replace(/<a href="(?!https?:)[^"]*"/g, '<a href="#"')
    .replace(/<a href="(https?:[^"]*)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"');
}

// 依 H1 切段，每段有一個錨點可以跳過去
function splitSections(md: string): { id: string; title: string; body: string }[] {
  const parts = md.split(/^(?=# )/m);
  return parts
    .filter((p) => p.trim())
    .map((p, i) => ({ id: `md-sec-${i}`, title: (p.match(/^# (.+)$/m)?.[1] ?? "（開頭）").trim(), body: p }));
}

const PROSE =
  "text-[13px] leading-relaxed text-slate-700 [&_a]:text-teal-700 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-slate-200 [&_blockquote]:pl-3 [&_blockquote]:text-slate-500 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-slate-900 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:border-b [&_h2]:border-slate-100 [&_h2]:pb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h4]:mt-3 [&_h4]:font-semibold [&_hr]:my-4 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5";

export function MarkdownModal({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const router = useRouter();
  const [view, setView] = useState<VersionMarkdownView | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const [result, setResult] = useState<OptimizeActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getVersionMarkdownAction(versionId).then((v) => {
      setView(v);
      setDraft(v?.markdown ?? "");
    });
  }, [versionId]);

  const dirty = view ? draft.trim() !== view.markdown.trim() : false;
  const source = tab === "edit" ? draft : (view?.markdown ?? "");
  const sections = useMemo(() => (tab === "preview" ? splitSections(source).map((s) => ({ ...s, html: renderMarkdown(s.body) })) : []), [source, tab]);

  function close() {
    if (dirty && !confirm("有修改還沒儲存，確定要關閉嗎？")) return;
    onClose();
  }

  function save() {
    setResult(null);
    startTransition(async () => {
      const r = await saveVersionMarkdownAction(versionId, draft);
      setResult(r);
      if (r.success && r.versionId) {
        // 另存成新版本時，之後的修改接著改新版本
        const v = await getVersionMarkdownAction(r.versionId);
        setView(v);
        setDraft(v?.markdown ?? draft);
        router.refresh();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={close}>
      <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <h3 className="mr-2 text-sm font-semibold text-slate-900">{view ? view.name : "md"}</h3>
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs" role="tablist">
            {(["preview", "edit"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 font-medium ${tab === t ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                {t === "preview" ? "預覽" : `編輯${dirty ? " •" : ""}`}
              </button>
            ))}
          </div>
          {tab === "preview" && sections.length > 1 && (
            <select
              aria-label="跳到某一份文件"
              defaultValue=""
              onChange={(e) => document.getElementById(e.target.value)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="max-w-56 rounded-lg border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="" disabled>
                跳到…（{sections.length} 份）
              </option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-2">
            <a href={`/api/km/versions/${versionId}/download`} className="rounded-lg px-3 py-1.5 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-50">
              下載 md
            </a>
            <a href={`/api/km/versions/${versionId}/download?format=pdf`} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">
              下載 PDF
            </a>
            <button type="button" onClick={close} aria-label="關閉" className="ml-1 text-lg leading-none text-slate-400 hover:text-slate-600">
              ×
            </button>
          </div>
        </div>

        {view === undefined ? (
          <p className="p-5 text-xs text-slate-500">載入中…</p>
        ) : !view ? (
          <p className="p-5 text-xs text-slate-500">找不到這個版本。</p>
        ) : tab === "preview" ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {dirty && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">目前顯示的是還沒儲存的修改內容。</p>}
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-2 border-b border-dashed border-slate-200 pb-4 last:border-0">
                <div className={PROSE} dangerouslySetInnerHTML={{ __html: s.html }} />
              </section>
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-5 py-3">
            <p className="flex items-center text-xs text-slate-500">
              {view.saveInPlace
                ? "這是還沒測過的手動修改版本，儲存會直接更新它。"
                : "儲存後會另存成新版本「（手動修改）」，原本的版本與分數保留。"}
              <InfoTip>
                測過或已部署到後台的版本，分數是那份 md 測出來的，所以修改會另存成新版本。在新版本按「從這版繼續」，會先把改好的 md 上傳測試一輪，有了分數再讓 AI 接著修改。
                {view.isDoc ? "結構化文件上傳時依「# 標題」（H1）切成一份一份，請保留每個 H1。" : ""}
              </InfoTip>
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-lg border border-slate-300 p-3 font-mono text-xs leading-relaxed shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] text-slate-400">
                {draft.length.toLocaleString()} 字（原本 {view.markdown.length.toLocaleString()} 字）
              </span>
              <Feedback result={result} />
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  disabled={!dirty || pending}
                  onClick={() => setDraft(view.markdown)}
                  className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  還原
                </button>
                <button
                  type="button"
                  disabled={!dirty || pending}
                  onClick={save}
                  className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                >
                  {pending ? "儲存中…" : view.saveInPlace ? "儲存" : "另存成新版本"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
