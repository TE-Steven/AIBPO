"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { IconSparkles, IconAlertTriangle, IconCheckCircle, IconX } from "@/components/icons";
import { addQuestionFilesAction, removeQuestionFileAction } from "./questionFileActions";
import { precheckSourceFile, SOURCE_FILE_ACCEPT, uploadSourceFile } from "../uploadClient";

// 題目來源檔案：已存在來源上的（檔名＋取出的圖片數）
export type QuestionFileView = { fileName: string; images: number };

function QuestionFilesPicker({ sourceId, files }: { sourceId: string; files: QuestionFileView[] }) {
  const router = useRouter();
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const picked = Array.from(list);
    const bad = picked.map((f) => [f.name, precheckSourceFile(f)] as const).find(([, err]) => err);
    if (bad) {
      setError(`「${bad[0]}」${bad[1]}`);
      if (input.current) input.current.value = "";
      return;
    }
    const uploads = [];
    let imagesUsed = files.reduce((n, f) => n + f.images, 0);
    try {
      for (const [i, file] of picked.entries()) {
        setUploading(`處理中 ${i + 1}／${picked.length}：${file.name}（內容很多時會先由 AI 萃取客戶問題，可能需要 1～3 分鐘）`);
        const { upload, stats } = await uploadSourceFile(file, imagesUsed, "questions");
        imagesUsed += stats.images;
        uploads.push(upload);
      }
      const result = await addQuestionFilesAction(sourceId, uploads);
      if (result.error) setError(result.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗");
      // 已經傳上去、但沒有加入的檔案從 Claude 刪掉
      if (uploads.length > 0) void fetch("/api/km/source-files", { method: "DELETE", body: JSON.stringify({ uploads }) });
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="mb-2 text-xs leading-relaxed text-slate-500">
        上傳客服對話紀錄、客戶提問清單等檔案，AI 會從裡面萃取客戶實際會問的問題（合併重複、改成清楚的問句、去掉個資），答案仍只根據這個來源的知識文件；知識文件找不到答案的問題不會產生。
      </p>
      {files.length > 0 && (
        <div className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {files.map((f) => (
            <div key={f.fileName} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <IconCheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {f.fileName}
                {f.images > 0 && <span className="ml-1.5 text-xs text-slate-400">（含 {f.images} 張圖）</span>}
              </span>
              <button
                type="button"
                disabled={pending || uploading !== null}
                onClick={() =>
                  startTransition(async () => {
                    await removeQuestionFileAction(sourceId, f.fileName);
                    router.refresh();
                  })
                }
                aria-label={`移除 ${f.fileName}`}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-50 hover:text-rose-600 disabled:opacity-50"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={SOURCE_FILE_ACCEPT}
        disabled={uploading !== null}
        onChange={(e) => void addFiles(e.target.files)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      <p className="mt-1 text-[11px] text-slate-400">
        支援 PDF、Word（.docx）、Excel（.xlsx）、文字檔（.txt／.csv）。對話紀錄很長時（超過約 30 萬字），會先由 AI 萃取出客戶問題並合併重複、記下次數，再拿去產生 FAQ；上限約 300 萬字。
      </p>
      {uploading && <p className="mt-1.5 text-xs text-teal-700">{uploading}</p>}
      {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

type Dimension = { id: string; name: string };

const BASE_STAGES = ["讀取來源內容", "依維度擷取重點", "整理成 FAQ 題目與答案", "產出結果"];
// 有文件範本時，FAQ 之後多一段「依範本整理結構化文件」
const DOC_STAGES = ["讀取來源內容", "依維度擷取重點", "整理成 FAQ 題目與答案", "依範本整理結構化文件", "產出結果"];

export function AnalysisRunner({
  sourceId,
  dimensions,
  hasTallies,
  templateNames,
  defaultCountMin = 10,
  defaultCountMax = 30,
  questionFiles = [],
}: {
  sourceId: string;
  dimensions: Dimension[];
  hasTallies: boolean;
  // 有子分類的第一層分類：勾選 Tally 時會依這些範本另外產出結構化文件
  templateNames: string[];
  // FAQ 題數預設值（來自 參數管理的設定）
  defaultCountMin?: number;
  defaultCountMax?: number;
  // 已上傳的題目來源檔案
  questionFiles?: QuestionFileView[];
}) {
  const router = useRouter();
  const [selectedDimensionIds, setSelectedDimensionIds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [useTally, setUseTally] = useState(hasTallies);
  // 同時產生結構化文件（跟 FAQ 歸類分開勾選；事後也能在「結構化文件」卡片產生）
  const [withDocs, setWithDocs] = useState(templateNames.length > 0);
  const [countMin, setCountMin] = useState(defaultCountMin);
  const [countMax, setCountMax] = useState(defaultCountMax);
  const [answerStyle, setAnswerStyle] = useState("");
  // 自行上傳檔案當作 FAQ 題目來源
  const [useQuestionFiles, setUseQuestionFiles] = useState(questionFiles.length > 0);

  const [running, setRunning] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [thinkingText, setThinkingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<{ faq: number; doc: number; docError: string | null } | null>(null);
  const stages = withDocs && templateNames.length > 0 ? DOC_STAGES : BASE_STAGES;
  const esRef = useRef<EventSource | null>(null);

  function toggleDimension(id: string) {
    setSelectedDimensionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function startAnalysis() {
    setRunning(true);
    setError(null);
    setDoneCount(null);
    setThinkingText("");
    setStageIndex(0);

    const dimensionNames = [
      ...dimensions.filter((d) => selectedDimensionIds.includes(d.id)).map((d) => d.name),
      ...freeText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ];

    const qs = new URLSearchParams({
      dimensions: JSON.stringify(dimensionNames),
      useTally: useTally ? "1" : "0",
      withDocs: withDocs && templateNames.length > 0 ? "1" : "0",
      countMin: String(countMin),
      countMax: String(countMax),
      answerStyle,
      useQuestionFiles: useQuestionFiles && questionFiles.length > 0 ? "1" : "0",
    });

    const es = new EventSource(`/api/km/sources/${sourceId}/analyze?${qs.toString()}`);
    esRef.current = es;

    es.addEventListener("status", () => setStageIndex(0));
    es.addEventListener("stage", () => setStageIndex(1));
    es.addEventListener("thinking", (e) => {
      const { text } = JSON.parse((e as MessageEvent).data);
      setStageIndex((i) => Math.max(i, 1));
      setThinkingText((prev) => (prev + text).slice(-4000));
    });
    es.addEventListener("text", () => setStageIndex((i) => Math.max(i, 2)));
    es.addEventListener("documents", () => {
      setStageIndex(3);
      setThinkingText("");
    });
    es.addEventListener("done", (e) => {
      const { count, docCount, docError } = JSON.parse((e as MessageEvent).data);
      setStageIndex(stages.length - 1);
      setDoneCount({ faq: count, doc: docCount ?? 0, docError: docError ?? null });
      es.close();
      router.refresh();
    });
    es.addEventListener("error", (e) => {
      try {
        const { message } = JSON.parse((e as MessageEvent).data);
        setError(message);
      } catch {
        setError("分析連線中斷，請重試。");
      }
      es.close();
      setRunning(false);
    });
  }

  if (running) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 animate-pulse items-center justify-center rounded-lg bg-teal-100 text-teal-600">
            <IconSparkles className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-slate-900">AI 分析中…</h2>
        </div>

        <ol className={`mb-4 grid grid-cols-2 gap-2 ${stages.length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
          {stages.map((label, i) => (
            <li
              key={label}
              className={`rounded-lg px-3 py-2 text-center text-xs font-medium ${
                i < stageIndex
                  ? "bg-emerald-50 text-emerald-600"
                  : i === stageIndex
                    ? "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200"
                    : "bg-slate-50 text-slate-400"
              }`}
            >
              {label}
            </li>
          ))}
        </ol>

        {error ? (
          <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-600 ring-1 ring-inset ring-rose-100">
            <IconAlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : doneCount !== null ? (
          <>
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-600 ring-1 ring-inset ring-emerald-100">
            <IconCheckCircle className="h-4 w-4 shrink-0" />
            分析完成，產出了 {doneCount.faq} 題 FAQ{doneCount.doc > 0 ? `、${doneCount.doc} 份結構化文件` : ""}。
          </p>
          {doneCount.docError && (
            <p className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700 ring-1 ring-inset ring-amber-100">
              <IconAlertTriangle className="h-4 w-4 shrink-0" />
              FAQ 已經存好，但結構化文件沒有產生成功：{doneCount.docError}（可以在來源頁按「重新產生結構化文件」）
            </p>
          )}
          </>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-300">
            {thinkingText || "AI 正在思考…"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">設定分析參數</h2>
      <p className="mb-4 text-xs text-slate-500">選擇這次分析想關注的維度，AI 會針對這些方向產出 FAQ。</p>

      {dimensions.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-slate-700">常用維度</p>
          <div className="flex flex-wrap gap-2">
            {dimensions.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => toggleDimension(d.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  selectedDimensionIds.includes(d.id)
                    ? "bg-teal-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">臨時維度（選填，一行一個）</label>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={2}
          placeholder={"例如：\n活動日期\n商品價格"}
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-6">
        {hasTallies && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={useTally}
              onChange={(e) => setUseTally(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
            />
            把 Tally 分類也當作維度依據（替每題 FAQ 建議分類）
          </label>
        )}
        {templateNames.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={withDocs}
              onChange={(e) => setWithDocs(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
            />
            同時產生結構化文件
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={useQuestionFiles}
            onChange={(e) => setUseQuestionFiles(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
          />
          自行上傳檔案當作 FAQ 題目來源
        </label>
        {templateNames.length > 0 && withDocs && (
          <p className="w-full text-xs text-slate-500">
            FAQ 完成後，會再依「{templateNames.join("」「")}」範本找出文件裡每一個項目，各整理成一份結構化文件（多一次 AI 呼叫）。不勾的話，之後也可以在「結構化文件」卡片產生。
          </p>
        )}
        {useQuestionFiles && <QuestionFilesPicker sourceId={sourceId} files={questionFiles} />}
        <div className="flex items-center gap-2 text-sm text-slate-700">
          FAQ 數量
          <input
            type="number"
            value={countMin}
            onChange={(e) => setCountMin(Number(e.target.value) || 1)}
            className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          ~
          <input
            type="number"
            value={countMax}
            onChange={(e) => setCountMax(Number(e.target.value) || 1)}
            className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          題
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">答案輸出風格（選填）</label>
        <textarea
          value={answerStyle}
          onChange={(e) => setAnswerStyle(e.target.value)}
          rows={2}
          placeholder={"例如：\n答案請控制在 100 字以內，語氣正式\n答案結尾要附上原文出處段落"}
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
        />
        <p className="mt-1 text-xs text-slate-400">這段文字會直接告訴 AI 該怎麼寫答案，例如字數限制、語氣、格式要求等。</p>
      </div>

      <button
        type="button"
        onClick={startAnalysis}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600"
      >
        <IconSparkles className="h-4 w-4" />
        開始分析
      </button>
    </div>
  );
}
