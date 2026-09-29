"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { stopKmAnalysisAction } from "./actions";
import { StuckNotice } from "./StuckNotice";

export function AnalysisStuckNotice({ sourceId, elapsedMinutes }: { sourceId: string; elapsedMinutes: number | null }) {
  const router = useRouter();
  const [stopping, startStop] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function stop() {
    setError(null);
    startStop(async () => {
      const result = await stopKmAnalysisAction(sourceId);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">AI 分析中…</h2>
      <StuckNotice elapsedMinutes={elapsedMinutes} onStop={stop} stopping={stopping} retryLabel="重新分析" />
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
