"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVersionAction, deleteVersionAction } from "./actions";
import { accuracyOf, formatDateTime, type VersionView } from "./knowledgeTypes";
import { IconAlertTriangle, IconCheckCircle, IconKey, IconPencil, IconSparkles, IconTrash, IconX } from "@/components/icons";

function tokenMinutesLeft(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? Math.floor((payload.exp * 1000 - Date.now()) / 60000) : null;
  } catch {
    return null;
  }
}

// 每題：送題約 10 秒 + 等 30 秒再撈答案；同時跑 3 題
function estimateMinutes(count: number) {
  return Math.max(1, Math.ceil((Math.ceil(count / 3) * 45) / 60));
}

const RUN_STATUS: Record<string, { label: string; className: string }> = {
  RUNNING: { label: "測試中", className: "bg-amber-50 text-amber-600" },
  DONE: { label: "已完成", className: "bg-emerald-50 text-emerald-600" },
  FAILED: { label: "中斷", className: "bg-rose-50 text-rose-600" },
};

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${wide ? "max-w-4xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="關閉" className="text-slate-400 hover:text-slate-600">
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function VersionRow({
  version,
  testCaseCount,
  targetReady,
  onViewResults,
}: {
  version: VersionView;
  testCaseCount: number;
  targetReady: boolean;
  onViewResults: (versionId: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(version.name);
  const [note, setNote] = useState(version.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [modal, setModal] = useState<null | "content" | "settings" | "token">(null);
  const [content, setContent] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; matched: number } | null>(null);
  const [message, setMessage] = useState<{ success?: string; error?: string }>({});
  const [pending, startTransition] = useTransition();

  const accuracy = accuracyOf(version.latestRun);
  const runStatus = version.latestRun ? RUN_STATUS[version.latestRun.status] : null;
  const minutesLeft = tokenInput ? tokenMinutesLeft(tokenInput.trim().replace(/^Bearer\s+/i, "")) : null;

  function save() {
    startTransition(async () => {
      const result = await updateVersionAction(version.id, { name, note });
      setMessage(result);
      if (result.success) setEditing(false);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteVersionAction(version.id);
      if (result.error) setMessage(result);
      setConfirmDelete(false);
    });
  }

  async function openContent() {
    setModal("content");
    if (content === null) {
      const res = await fetch(`/api/km/versions/${version.id}/download`);
      setContent(res.ok ? await res.text() : "讀取失敗，請重新整理後再試。");
    }
  }

  async function runTest() {
    const token = tokenInput.trim();
    setTokenInput("");
    setModal(null);
    setRunning(true);
    setMessage({});
    setProgress({ done: 0, total: testCaseCount, matched: 0 });
    try {
      const res = await fetch(`/api/km/versions/${version.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setMessage({ error: data.error ?? "測試啟動失敗，請重試一次。" });
        return;
      }
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
            setProgress({ done: 0, total: data.total, matched: 0 });
          } else if (event === "result") {
            setProgress((p) => (p ? { ...p, done: p.done + 1, matched: p.matched + (data.judgeVerdict === "MATCH" ? 1 : 0) } : p));
          } else if (event === "done") {
            setMessage(data.status === "FAILED" ? { error: data.errorMessage ?? "測試中斷。" } : { success: "測試完成，可以到「版本比較」查看每一題的結果。" });
          }
        }
      }
    } catch {
      setMessage({ error: "連線中斷；已完成的題目會保留，重新整理頁面可以看到最新結果。" });
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="版本名稱"
                className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
              />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="備註（例如這一版改了什麼）"
                aria-label="版本備註"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
              />
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="rounded-md bg-teal-600 px-3 py-1.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  儲存
                </button>
                <button type="button" onClick={() => setEditing(false)} className="font-medium text-slate-500 hover:text-slate-700">
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-slate-900">{version.name}</span>
                <button type="button" onClick={() => setEditing(true)} aria-label="編輯版本" className="text-slate-300 hover:text-teal-600">
                  <IconPencil className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-slate-400">
                  {formatDateTime(version.createdAt)}・{version.entryCount} 題
                </span>
              </div>
              {version.note && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{version.note}</p>}
            </>
          )}
        </div>

        <div className="text-right">
          {accuracy ? (
            <button type="button" onClick={() => onViewResults(version.id)} className="group text-right">
              <span className="block text-2xl font-bold tabular-nums text-slate-900 group-hover:text-teal-700">{accuracy.percent}%</span>
              <span className="text-xs text-slate-500">
                一致 {accuracy.matched}/{accuracy.total}
                {runStatus && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 ${runStatus.className}`}>{runStatus.label}</span>}
              </span>
            </button>
          ) : (
            <span className="text-xs text-slate-400">尚未測試</span>
          )}
        </div>
      </div>

      {running && progress && (
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
          <span>
            測試中… {progress.done}/{progress.total}・一致 {progress.matched}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-400 transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
      {(message.success || message.error) && (
        <p
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${
            message.error ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"
          }`}
        >
          {message.error ? <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <IconCheckCircle className="h-3.5 w-3.5 shrink-0" />}
          {message.error ?? message.success}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs">
        <a href={`/api/km/versions/${version.id}/download`} download className="font-medium text-teal-600 hover:text-teal-700">
          下載 .md
        </a>
        <a href={`/api/km/versions/${version.id}/download?format=pdf`} download className="font-medium text-teal-600 hover:text-teal-700">
          下載 PDF
        </a>
        <button type="button" onClick={openContent} className="font-medium text-slate-600 hover:text-teal-700">
          查看內容
        </button>
        <button type="button" onClick={() => setModal("settings")} className="font-medium text-slate-600 hover:text-teal-700">
          當時設定
        </button>
        <div className="ml-auto flex items-center gap-4">
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-rose-600">刪除這一版和它的測試紀錄？</span>
              <button type="button" onClick={remove} disabled={pending} className="font-semibold text-rose-600 hover:text-rose-700">
                確定刪除
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-slate-500 hover:text-slate-700">
                取消
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1 font-medium text-slate-400 hover:text-rose-600"
            >
              <IconTrash className="h-3.5 w-3.5" />
              刪除
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setTokenInput("");
              setModal("token");
            }}
            disabled={running || !targetReady || testCaseCount === 0}
            title={!targetReady ? "這間公司還沒設定機器人 API" : testCaseCount === 0 ? "測試題庫是空的" : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3 py-1.5 font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
          >
            <IconSparkles className="h-3.5 w-3.5" />
            {running ? "測試中…" : "用題庫測試"}
          </button>
        </div>
      </div>

      {modal === "content" && (
        <Modal title={`${version.name} 的內容`} onClose={() => setModal(null)} wide>
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">{content ?? "讀取中…"}</pre>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title={`${version.name} 建立時的設定`} onClose={() => setModal(null)} wide>
          <div className="space-y-4 text-sm">
            <div>
              <p className="mb-1 text-xs font-bold tracking-wider text-slate-400">Prompt 最高準則</p>
              <p className="whitespace-pre-wrap text-slate-700">{version.settings.guidelines || "（未設定）"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold tracking-wider text-slate-400">Prompt 管理中改過的規則</p>
              <p className="text-slate-700">
                {version.settings.modifiedRules.length > 0 ? version.settings.modifiedRules.join("、") : "（全部使用預設）"}
              </p>
              {version.settings.modifiedOptions.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">改過的數值與匯出設定：{version.settings.modifiedOptions.join("、")}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-bold tracking-wider text-slate-400">分類與描述</p>
              {version.settings.tallies.length > 0 ? (
                <ul className="space-y-0.5 text-xs text-slate-700">
                  {version.settings.tallies.map((t) => (
                    <li key={t.path}>
                      {t.path}
                      {t.description && <span className="text-slate-500">：{t.description}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">（沒有分類）</p>
              )}
            </div>
          </div>
        </Modal>
      )}
      {modal === "token" && (
        <Modal title={`用測試題庫測試 ${version.name}`} onClose={() => setModal(null)}>
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
            請先確認已經把「{version.name}」的檔案上傳到 chatbot，否則測到的會是 chatbot 目前載入的其他版本。
          </p>
          <p className="mb-3 text-xs text-slate-500">
            題庫 {testCaseCount} 題，預估約 {estimateMinutes(testCaseCount)} 分鐘。
          </p>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <IconKey className="h-4 w-4 text-teal-600" />
            Access token
          </label>
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
            <p className={`mt-1 text-xs ${minutesLeft < estimateMinutes(testCaseCount) + 2 ? "text-rose-600" : "text-slate-500"}`}>
              {minutesLeft <= 0 ? "這個 token 已經過期了" : `這個 token 還有約 ${minutesLeft} 分鐘有效`}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={() => setModal(null)} className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700">
              取消
            </button>
            <button
              type="button"
              onClick={runTest}
              disabled={!tokenInput.trim() || (minutesLeft !== null && minutesLeft <= 0)}
              className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
            >
              開始測試
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function VersionsPanel({
  versions,
  testCaseCount,
  targetReady,
  onViewResults,
}: {
  versions: VersionView[];
  testCaseCount: number;
  targetReady: boolean;
  onViewResults: (versionId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        流程：在「題目」分頁勾選題目 → <b>建立版本</b> → 下載 .md 上傳到 chatbot → 回到這裡按 <b>用題庫測試</b> → 到「版本比較」看每一題的差異。
        {!targetReady && <span className="ml-1 text-amber-700">這間公司還沒設定機器人 API，需要平台管理員先設定才能測試。</span>}
      </div>
      {versions.map((v) => (
        <VersionRow key={v.id} version={v} testCaseCount={testCaseCount} targetReady={targetReady} onViewResults={onViewResults} />
      ))}
      {versions.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
          還沒有任何版本：到「題目」分頁勾選題目後按「建立版本」。
        </div>
      )}
    </div>
  );
}
