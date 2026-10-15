// 把 AI 提出的局部修改套用到 md（純函式）：用 anchor（md 裡現有的一段原文）定位，取代／插在後面／刪除。
// 定位先找完全一致；找不到再忽略空白差異比對。找不到的修改不套用，回報給呼叫端。

export type MdEdit = {
  action: "replace" | "insert_after" | "delete";
  anchor: string;
  text: string;
  reason: string;
  questions: number[];
};

// rejected：違反分類結構（新增、改名或刪掉分類層級的標題）而沒有套用的原因
export type AppliedEdit = MdEdit & { applied: boolean; rejected?: string };

// md 裡的標題行（正規化空白），level ≤ maxLevel 的才算
function headingLines(text: string, maxLevel: number): string[] {
  return [...text.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].filter((m) => m[1].length <= maxLevel).map((m) => `${m[1]} ${m[2].replace(/\s+/g, " ")}`);
}

// 分類層級的標題（結構化文件：# 項目、## 維度、### 子維度）是依分類管理產生的，AI 不能新增、改名或刪除
function structureViolation(md: string, region: string, edit: MdEdit, maxLevel: number): string | null {
  const existing = new Set(headingLines(md, maxLevel));
  const added = edit.action === "delete" ? [] : headingLines(edit.text, maxLevel).filter((h) => !existing.has(h));
  if (added.length > 0) return `新增或改名了分類層級的標題「${added[0]}」`;
  if (edit.action !== "insert_after") {
    const kept = new Set(edit.action === "replace" ? headingLines(edit.text, maxLevel) : []);
    const removed = headingLines(region, maxLevel).filter((h) => !kept.has(h));
    if (removed.length > 0) return `刪除了分類層級的標題「${removed[0]}」`;
  }
  return null;
}

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

// structureLevel：保護到第幾層標題（0＝不檢查）
export function applyMdEdits(markdown: string, edits: MdEdit[], structureLevel = 0): { markdown: string; edits: AppliedEdit[] } {
  let md = markdown;
  const results: AppliedEdit[] = [];
  for (const edit of edits) {
    const anchor = edit.anchor.trim();
    const pos = anchor ? locate(md, anchor) : null;
    if (!pos) {
      results.push({ ...edit, applied: false });
      continue;
    }
    const violation = structureLevel > 0 ? structureViolation(md, md.slice(pos.start, pos.end), edit, structureLevel) : null;
    if (violation) {
      results.push({ ...edit, applied: false, rejected: violation });
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
