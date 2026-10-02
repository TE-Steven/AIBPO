// 把 AI 提出的局部修改套用到 md（純函式）：用 anchor（md 裡現有的一段原文）定位，取代／插在後面／刪除。
// 定位先找完全一致；找不到再忽略空白差異比對。找不到的修改不套用，回報給呼叫端。

export type MdEdit = {
  action: "replace" | "insert_after" | "delete";
  anchor: string;
  text: string;
  reason: string;
  questions: number[];
};

export type AppliedEdit = MdEdit & { applied: boolean };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 回傳 anchor 在 md 裡的位置（第一個出現處）；空白不一致時用寬鬆比對
function locate(markdown: string, anchor: string): { start: number; end: number } | null {
  const exact = markdown.indexOf(anchor);
  if (exact >= 0) return { start: exact, end: exact + anchor.length };
  const tokens = anchor.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (tokens.length === 0) return null;
  const match = new RegExp(tokens.join("\\s+")).exec(markdown);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

export function applyMdEdits(markdown: string, edits: MdEdit[]): { markdown: string; edits: AppliedEdit[] } {
  let md = markdown;
  const results: AppliedEdit[] = [];
  for (const edit of edits) {
    const anchor = edit.anchor.trim();
    const pos = anchor ? locate(md, anchor) : null;
    if (!pos) {
      results.push({ ...edit, applied: false });
      continue;
    }
    const text = edit.text.trim();
    if (edit.action === "replace") {
      md = md.slice(0, pos.start) + text + md.slice(pos.end);
    } else if (edit.action === "insert_after") {
      md = `${md.slice(0, pos.end)}\n\n${text}${md.slice(pos.end)}`;
    } else {
      md = md.slice(0, pos.start) + md.slice(pos.end);
    }
    results.push({ ...edit, applied: true });
  }
  // 刪除或插入後可能留下多餘空行
  return { markdown: md.replace(/\n{3,}/g, "\n\n").trim(), edits: results };
}
