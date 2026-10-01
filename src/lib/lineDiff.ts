// 兩份文字逐行比對（LCS），版本比較顯示 md 改了哪幾行用。純函式。

export type DiffLine = { type: "same" | "add" | "del"; text: string };
export type DiffRow = DiffLine | { type: "skip"; count: number };

// 太長就不做逐行比對（記憶體約 cells × 4 bytes）
const MAX_CELLS = 9_000_000;

export function diffLines(oldText: string, newText: string): DiffLine[] | null {
  const a = oldText.split("\n");
  const b = newText.split("\n");

  // 先去掉頭尾相同的行，縮小要比對的範圍
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  // lcs[i][j]：midA[i..] 與 midB[j..] 的最長共同子序列長度
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = midA[i] === midB[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ type: "same" as const, text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      out.push({ type: "same", text: midA[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      out.push({ type: "del", text: midA[i++] });
    } else {
      out.push({ type: "add", text: midB[j++] });
    }
  }
  while (i < n) out.push({ type: "del", text: midA[i++] });
  while (j < m) out.push({ type: "add", text: midB[j++] });
  for (const text of a.slice(endA)) out.push({ type: "same", text });
  return out;
}

// 只保留有改動的地方與前後幾行，其餘相同的行收合成「略過 N 行」
export function collapseUnchanged(lines: DiffLine[], context = 2): DiffRow[] {
  const keep = lines.map(() => false);
  lines.forEach((l, idx) => {
    if (l.type === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
  });
  const rows: DiffRow[] = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped > 0) rows.push({ type: "skip", count: skipped });
      skipped = 0;
      rows.push(l);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) rows.push({ type: "skip", count: skipped });
  return rows;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "del").length,
  };
}
