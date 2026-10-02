// 知識列表頁（題目／版本／測試題庫／版本比較）在 server 頁面與 client 元件之間傳的資料形狀

export type VersionResultView = {
  testCaseId: string | null;
  order: number;
  question: string;
  expectedAnswer: string;
  botAnswer: string | null;
  status: string; // PENDING / ANSWERED / TIMEOUT / ERROR
  errorMessage: string | null;
  judgeVerdict: string | null; // MATCH / PARTIAL / MISMATCH / ERROR
  judgeReason: string | null;
};

export type VersionRunView = {
  id: string;
  status: string; // RUNNING / DONE / FAILED
  total: number;
  completed: number;
  errorMessage: string | null;
  createdAt: string;
  results: VersionResultView[];
};

export type VersionView = {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
  entryCount: number;
  settings: {
    guidelines: string;
    modifiedRules: string[];
    modifiedOptions: string[];
    tallies: { path: string; description: string | null }[];
  };
  latestRun: VersionRunView | null;
};

export type TestCaseView = {
  id: string;
  question: string;
  expectedAnswer: string;
  archived: boolean;
  createdAt: string;
};

export function accuracyOf(run: VersionRunView | null): { matched: number; total: number; percent: number } | null {
  if (!run || run.total === 0) return null;
  const matched = run.results.filter((r) => r.judgeVerdict === "MATCH").length;
  return { matched, total: run.total, percent: Math.round((matched / run.total) * 100) };
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export type CompareCell = VersionResultView | null;
export type CompareRow = {
  key: string;
  question: string;
  expectedAnswer: string;
  cells: CompareCell[]; // 跟傳入的版本順序一致
  // 最後兩個版本之間的變化：improved＝不一致→一致；regressed＝一致→不一致；changed＝回答內容不同但判定相同
  change: "improved" | "regressed" | "changed" | "same" | null;
};

// 版本比較：把各版本最近一次測試的結果依題目對齊（同一題庫題目用 testCaseId，題目已被刪除時退回用題目文字）。
// versions 請依建立時間舊→新傳入。
export function buildComparison(versions: VersionView[]): CompareRow[] {
  const rows = new Map<string, CompareRow>();
  versions.forEach((v, vi) => {
    for (const r of v.latestRun?.results ?? []) {
      const key = r.testCaseId ?? `q:${r.question.trim()}`;
      let row = rows.get(key);
      if (!row) {
        row = { key, question: r.question, expectedAnswer: r.expectedAnswer, cells: versions.map(() => null), change: null };
        rows.set(key, row);
      }
      row.cells[vi] = r;
      // 題目／標準答案以最新版本的快照為準
      row.question = r.question;
      row.expectedAnswer = r.expectedAnswer;
    }
  });

  const list = Array.from(rows.values());
  if (versions.length >= 2) {
    for (const row of list) {
      const prev = row.cells[versions.length - 2];
      const curr = row.cells[versions.length - 1];
      if (!prev || !curr) continue;
      const prevOk = prev.judgeVerdict === "MATCH";
      const currOk = curr.judgeVerdict === "MATCH";
      row.change =
        !prevOk && currOk ? "improved" : prevOk && !currOk ? "regressed" : (prev.botAnswer ?? "") !== (curr.botAnswer ?? "") ? "changed" : "same";
    }
  }
  return list;
}
