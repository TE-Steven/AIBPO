"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { stripBotDisclaimer } from "@/lib/botTestShared";
import { IconAlertTriangle, IconKey, IconSparkles, IconX } from "@/components/icons";

export type BotTestResultView = {
  id: string;
  order: number;
  question: string;
  expectedAnswer: string;
  botAnswer: string | null;
  status: string;
  errorMessage: string | null;
};

export type BotTestRunView = {
  id: string;
  status: string;
  total: number;
  completed: number;
  errorMessage: string | null;
  createdAt: string;
  results: BotTestResultView[];
};

type ModalState = { mode: "run" } | { mode: "retest"; resultIds: string[] };

type Patch = Partial<Pick<BotTestResultView, "botAnswer" | "status" | "errorMessage">>;

const RESULT_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "等待回答…", className: "bg-amber-50 text-amber-600" },
  ANSWERED: { label: "已回答", className: "bg-emerald-50 text-emerald-600" },
  TIMEOUT: { label: "逾時", className: "bg-slate-100 text-slate-500" },
  ERROR: { label: "錯誤", className: "bg-rose-50 text-rose-600" },
};

const RUN_STATUS: Record<string, string> = { RUNNING: "進行中", DONE: "完成", FAILED: "中斷" };

// 每題：送題約 15 秒 + 等 30 秒再撈答案；同時跑 3 題。
function estimateMinutes(count: number) {
  return Math.max(1, Math.ceil((Math.ceil(count / 3) * 45) / 60));
}

function tokenMinutesLeft(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? Math.floor((payload.exp * 1000 - Date.now()) / 60000) : null;
  } catch {
    return null;
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function BotTestPanel({
  sourceId,
  entryCount,
  runs,
  targetLabel,
}: {
  sourceId: string;
  entryCount: number;
  runs: BotTestRunView[];
  targetLabel: string | null;
}) {
  const router = useRouter();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);
  const [patches, setPatches] = useState<Record<string, Patch>>({});
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 彈窗：mode "run" 整批測試（建立新的一次測試）、"retest" 在目前這次測試裡重測指定題目
  const [modal, setModal] = useState<ModalState | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  // token 只留在這個頁面的記憶體裡，方便同一批做單題重測；重新整理頁面就沒了。
  const [token, setToken] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  // 「重新測試」的勾選模式
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const results = (selectedRun?.results ?? []).map((r) => ({ ...r, ...patches[r.id] }));
  const doneCount = results.filter((r) => r.status !== "PENDING").length;

  const allChecked = results.length > 0 && results.every((r) => checked.has(r.id));

  function toggleChecked(resultId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
  }

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(results.map((r) => r.id)));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setChecked(new Set());
  }

  function selectRun(runId: string) {
    setSelectedRunId(runId);
    exitSelectMode();
  }

  function openModal(next: ModalState) {
    setTokenInput(token);
    setModal(next);
  }

  async function start() {
    if (!modal) return;
    const useToken = tokenInput.trim();
    const payload = modal.mode === "retest" ? { token: useToken, resultIds: modal.resultIds } : { token: useToken };
    if (modal.mode === "retest") {
      const resetIds = modal.resultIds;
      setPatches((p) => {
        const next = { ...p };
        for (const resultId of resetIds) next[resultId] = { status: "PENDING", botAnswer: null, errorMessage: null };
        return next;
      });
    }
    setModal(null);
    exitSelectMode();
    setRunning(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/km/sources/${sourceId}/bot-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setMessage(data.error ?? "測試啟動失敗，請重試一次。");
        return;
      }
      setToken(useToken);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const event = chunk.match(/^event: (.+)$/m)?.[1];
          const dataLine = chunk.match(/^data: (.+)$/m)?.[1];
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (event === "start") {
            setSelectedRunId(data.runId);
            router.refresh();
          } else if (event === "result") {
            setPatches((p) => ({ ...p, [data.id]: { status: data.status, botAnswer: data.botAnswer, errorMessage: data.errorMessage } }));
          } else if (event === "done" && data.status === "FAILED") {
            setMessage(data.errorMessage ?? "測試中斷。");
          }
        }
      }
    } catch {
      setMessage("連線中斷；已完成的題目會保留，重新整理頁面可以看到最新結果。");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  const minutesLeft = tokenInput ? tokenMinutesLeft(tokenInput.trim().replace(/^Bearer\s+/i, "")) : null;
  const modalCount = modal?.mode === "retest" ? modal.resultIds.length : entryCount;

  const latestRun = runs[0] ?? null;
  const latestAnswered = latestRun ? latestRun.results.filter((r) => (patches[r.id]?.status ?? r.status) === "ANSWERED").length : 0;

  return (
    <>
      {/* 來源頁上只放一行摘要，執行與結果都在彈窗裡看 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-sm">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">機器人測試</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {running
              ? `測試中… ${doneCount} / ${results.length || entryCount} 題完成`
              : latestRun
                ? `上次測試 ${formatTime(latestRun.createdAt)}（${RUN_STATUS[latestRun.status] ?? latestRun.status}）：${latestAnswered} / ${latestRun.total} 題有回答`
                : `把這個來源的 ${entryCount} 題逐題丟給現行機器人，並排對照標準答案與機器人回答。`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600"
        >
          <IconSparkles className="h-3.5 w-3.5" />
          {running ? "查看進度" : latestRun ? "查看結果 / 測試" : "開啟機器人測試"}
        </button>
      </div>

      {panelOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setPanelOpen(false)}>
          <div
            className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-100 px-6 py-4">
              {/* 第一列：標題 + 右上角關閉；第二列：操作按鈕（寬度不夠時換行也不會把叉叉擠走） */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">機器人測試</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    把這個來源的 {entryCount} 題逐題丟給現行機器人（每題用全新的客戶身分），並排對照標準答案與機器人回答。測試中關掉視窗不會中斷。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  aria-label="關閉"
                  className="-mr-2 -mt-1 shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <IconX className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {runs.length > 0 && (
                  <select
                    value={selectedRunId ?? ""}
                    onChange={(e) => selectRun(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs shadow-sm focus:border-teal-400 focus:outline-none"
                  >
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {formatTime(r.createdAt)}（{RUN_STATUS[r.status] ?? r.status}）
                      </option>
                    ))}
                  </select>
                )}
                {selectedRun && results.length > 0 && (
                  <button
                    type="button"
                    onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                    disabled={running || !targetLabel}
                    className={`rounded-lg border px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                      selectMode
                        ? "border-teal-300 bg-teal-50 text-teal-700"
                        : "border-slate-300 text-slate-600 hover:border-teal-400 hover:text-teal-600"
                    }`}
                  >
                    重新測試
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openModal({ mode: "run" })}
                  disabled={running || !targetLabel || entryCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
                >
                  <IconSparkles className="h-3.5 w-3.5" />
                  {running ? "測試中…" : "開始機器人測試"}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!targetLabel && (
                <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-100">
                  <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  這間公司還沒設定機器人 API，請聯絡平台管理員設定後才能測試。
                </p>
              )}
              {message && (
                <p className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-inset ring-rose-100">
                  <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {message}
                </p>
              )}

              {selectedRun && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-3 text-xs text-slate-500">
                    <span>
                      {doneCount} / {results.length} 題完成
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-400 transition-all"
                        style={{ width: `${results.length ? (doneCount / results.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  {selectedRun.errorMessage && selectedRun.status === "FAILED" && (
                    <p className="mb-2 text-xs text-rose-600">這次測試中斷：{selectedRun.errorMessage}</p>
                  )}
                  {selectMode && (
                    <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-800 ring-1 ring-inset ring-teal-100">
                      <span>勾選要重測的題目，新結果會覆蓋這次測試裡的舊回答。已選 {checked.size} 題</span>
                      <button type="button" onClick={toggleAll} className="font-medium text-teal-700 hover:text-teal-900">
                        {allChecked ? "取消全選" : "全部勾選"}
                      </button>
                      <div className="ml-auto flex items-center gap-3">
                        <button type="button" onClick={exitSelectMode} className="font-medium text-slate-500 hover:text-slate-700">
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => openModal({ mode: "retest", resultIds: results.filter((r) => checked.has(r.id)).map((r) => r.id) })}
                          disabled={checked.size === 0}
                          className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3 py-1.5 font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
                        >
                          重測選取的 {checked.size} 題
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full min-w-[720px] table-fixed text-left text-xs">
                      <thead className="bg-slate-50 font-medium text-slate-500">
                        <tr>
                          {selectMode && (
                            <th className="w-10 px-3 py-2">
                              <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="全部勾選" className="accent-teal-600" />
                            </th>
                          )}
                          <th className="w-10 px-3 py-2">#</th>
                          <th className="w-1/5 px-3 py-2">題目</th>
                          <th className="px-3 py-2">標準答案</th>
                          <th className="px-3 py-2">機器人回答</th>
                          <th className="w-24 px-3 py-2">狀態</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 align-top">
                        {results.map((r) => {
                          const s = RESULT_STATUS[r.status] ?? RESULT_STATUS.PENDING;
                          return (
                            <tr
                              key={r.id}
                              onClick={selectMode ? () => toggleChecked(r.id) : undefined}
                              className={selectMode ? `cursor-pointer ${checked.has(r.id) ? "bg-teal-50/60" : "hover:bg-slate-50"}` : undefined}
                            >
                              {selectMode && (
                                <td className="px-3 py-2.5">
                                  <input
                                    type="checkbox"
                                    checked={checked.has(r.id)}
                                    onChange={() => toggleChecked(r.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label={`勾選第 ${r.order} 題`}
                                    className="accent-teal-600"
                                  />
                                </td>
                              )}
                              <td className="px-3 py-2.5 text-slate-400">{r.order}</td>
                              <td className="whitespace-pre-wrap px-3 py-2.5 font-medium text-slate-800">{r.question}</td>
                              <td className="whitespace-pre-wrap px-3 py-2.5 text-slate-600">{r.expectedAnswer}</td>
                              <td className="whitespace-pre-wrap px-3 py-2.5 text-slate-700">
                                {r.botAnswer ? stripBotDisclaimer(r.botAnswer) : <span className="text-slate-400">{r.errorMessage ?? "—"}</span>}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`rounded-full px-2 py-0.5 font-medium ${s.className}`}>{s.label}</span>
                                {(r.status === "TIMEOUT" || r.status === "ERROR") && !running && !selectMode && (
                                  <button
                                    type="button"
                                    onClick={() => openModal({ mode: "retest", resultIds: [r.id] })}
                                    className="mt-1.5 block font-medium text-teal-600 hover:text-teal-700"
                                  >
                                    重測
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {results.length === 0 && (
                          <tr>
                            <td colSpan={selectMode ? 6 : 5} className="px-3 py-6 text-center text-slate-400">
                              載入中…
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!selectedRun && targetLabel && (
                <p className="py-16 text-center text-sm text-slate-400">還沒有測試紀錄，按右上角「開始機器人測試」開始。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <IconKey className="h-4 w-4 text-teal-600" />
                {modal.mode === "retest" ? `重新測試 ${modal.resultIds.length} 題` : "開始機器人測試"}
              </h3>
              <button type="button" onClick={() => setModal(null)} aria-label="關閉" className="text-slate-400 hover:text-slate-600">
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <dl className="mb-4 space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-400">測試目標</dt>
                <dd className="break-all text-slate-700">{targetLabel}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-400">題數</dt>
                <dd className="text-slate-700">
                  {modalCount} 題，預估約 {estimateMinutes(modalCount)} 分鐘
                </dd>
              </div>
            </dl>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Access token</label>
            <input
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="貼上 telligent 的 Bearer token"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
            <p className="mt-1.5 text-xs text-slate-400">token 只用在這次測試，不會被儲存。</p>
            {minutesLeft !== null && (
              <p className={`mt-1 text-xs ${minutesLeft < estimateMinutes(modalCount) + 2 ? "text-rose-600" : "text-slate-500"}`}>
                {minutesLeft <= 0 ? "這個 token 已經過期了" : `這個 token 還有約 ${minutesLeft} 分鐘有效`}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setModal(null)} className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700">
                取消
              </button>
              <button
                type="button"
                onClick={start}
                disabled={!tokenInput.trim() || (minutesLeft !== null && minutesLeft <= 0)}
                className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
              >
                開始測試
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
