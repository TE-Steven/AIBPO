// 「進行中」卻不是這個分頁在等結果（重新整理過、或伺服器重新部署把請求中斷）時顯示：已進行多久 + 停止按鈕。
export function StuckNotice({
  elapsedMinutes,
  onStop,
  stopping,
  retryLabel = "重新產生",
  className = "mt-3",
}: {
  elapsedMinutes: number | null;
  onStop: () => void;
  stopping: boolean;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={`${className} flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-100`}
    >
      <span className="flex-1">
        {elapsedMinutes === null ? "進行中，無法確認開始時間" : `已進行約 ${elapsedMinutes} 分鐘`}
        。一般幾分鐘內就會完成；如果等很久都沒動靜，可能是中途被中斷了，可以停止後{retryLabel}。
      </span>
      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
      >
        {stopping ? "停止中…" : "停止"}
      </button>
    </div>
  );
}
