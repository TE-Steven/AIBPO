"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { IconSparkles, IconAlertTriangle, IconCheckCircle } from "@/components/icons";

type Dimension = { id: string; name: string };

const STAGES = ["讀取來源內容", "依維度擷取重點", "整理成 FAQ 題目與答案", "產出結果"] as const;

export function AnalysisRunner({
  sourceId,
  dimensions,
  hasTallies,
}: {
  sourceId: string;
  dimensions: Dimension[];
  hasTallies: boolean;
}) {
  const router = useRouter();
  const [selectedDimensionIds, setSelectedDimensionIds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [useTally, setUseTally] = useState(hasTallies);
  const [countMin, setCountMin] = useState(10);
  const [countMax, setCountMax] = useState(30);
  const [answerStyle, setAnswerStyle] = useState("");

  const [running, setRunning] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [thinkingText, setThinkingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
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
      countMin: String(countMin),
      countMax: String(countMax),
      answerStyle,
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
    es.addEventListener("done", (e) => {
      const { count } = JSON.parse((e as MessageEvent).data);
      setStageIndex(3);
      setDoneCount(count);
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
          <span className="flex h-8 w-8 shrink-0 animate-pulse items-center justify-center rounded-lg bg-violet-100 text-violet-600">
            <IconSparkles className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-slate-900">AI 分析中…</h2>
        </div>

        <ol className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STAGES.map((label, i) => (
            <li
              key={label}
              className={`rounded-lg px-3 py-2 text-center text-xs font-medium ${
                i < stageIndex
                  ? "bg-emerald-50 text-emerald-600"
                  : i === stageIndex
                    ? "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200"
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
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-600 ring-1 ring-inset ring-emerald-100">
            <IconCheckCircle className="h-4 w-4 shrink-0" />
            分析完成，產出了 {doneCount} 題 FAQ。
          </p>
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
                    ? "bg-violet-600 text-white"
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
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-6">
        {hasTallies && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={useTally}
              onChange={(e) => setUseTally(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-400"
            />
            把 Tally 分類也當作維度依據
          </label>
        )}
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
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
        />
        <p className="mt-1 text-xs text-slate-400">這段文字會直接告訴 AI 該怎麼寫答案，例如字數限制、語氣、格式要求等。</p>
      </div>

      <button
        type="button"
        onClick={startAnalysis}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 transition hover:from-violet-700 hover:to-indigo-600"
      >
        <IconSparkles className="h-4 w-4" />
        開始分析
      </button>
    </div>
  );
}
