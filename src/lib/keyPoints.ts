// 關鍵答案比對：前後端共用的型別與判定規則（純函式，不依賴 Node API）。
// AI 只負責逐點標記；最後是否一致由這裡依參數管理的比對規則計算，同樣的標記一定得到同樣的結果。

export type KeyPoint = { text: string; required: boolean; aliases: string[] };

export type PointStatus = "COVERED" | "MISSING" | "WRONG";
export type JudgedPoint = { text: string; required: boolean; status: PointStatus; evidence: string };
export type JudgeDetail = { points: JudgedPoint[]; conflicts: string[]; coverage: number };

export type JudgeVerdict = "MATCH" | "PARTIAL" | "MISMATCH" | "ERROR";

export const VERDICT_LABELS: Record<string, string> = {
  MATCH: "一致",
  PARTIAL: "部分一致",
  MISMATCH: "不一致",
  ERROR: "比對失敗",
};

// 算「答對」：一致與部分一致都算（部分一致＝沒講錯，只是必要點沒講全）；正確率、版本比較、自動優化都用這個
export function isPassVerdict(verdict: string | null | undefined): boolean {
  return verdict === "MATCH" || verdict === "PARTIAL";
}

export const POINT_STATUS_LABELS: Record<PointStatus, string> = { COVERED: "有講到", MISSING: "沒講到", WRONG: "講錯" };

const MAX_POINTS = 8;

// 整理使用者編輯或 AI 產生的關鍵答案：去空白、去重複、最多 8 點，至少一點必要
export function cleanKeyPoints(input: unknown): KeyPoint[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const points: KeyPoint[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Partial<KeyPoint>;
    const text = typeof r.text === "string" ? r.text.trim().slice(0, 300) : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const aliases = Array.isArray(r.aliases)
      ? [...new Set(r.aliases.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter(Boolean))].slice(0, 10)
      : [];
    points.push({ text, required: r.required !== false, aliases });
    if (points.length >= MAX_POINTS) break;
  }
  if (points.length > 0 && !points.some((p) => p.required)) points[0] = { ...points[0], required: true };
  return points;
}

export function coverageOf(points: JudgedPoint[]): number {
  if (points.length === 0) return 0;
  return Math.round((points.filter((p) => p.status === "COVERED").length / points.length) * 100);
}

// 判定規則：
// - 講錯（任何一點，或設定為只看必要點時的必要點）或多講且講錯 → 不一致
// - 一個關鍵答案都沒講到 → 不一致
// - 必要的關鍵答案全部講到、整體涵蓋率達門檻、沒有次要點講錯 → 一致
// - 其他 → 部分一致
export function decideVerdict(
  points: JudgedPoint[],
  conflicts: string[],
  options: { minCoverage: number; wrongTolerance: "any" | "requiredOnly" },
): { verdict: Exclude<JudgeVerdict, "ERROR">; reason: string | null; coverage: number } {
  const coverage = coverageOf(points);
  const wrong = points.filter((p) => p.status === "WRONG");
  const fatalWrong = options.wrongTolerance === "any" ? wrong : wrong.filter((p) => p.required);
  if (fatalWrong.length > 0 || conflicts.length > 0) {
    const parts = [
      fatalWrong.length > 0 ? `講錯：${fatalWrong.map((p) => p.text).join("；")}` : null,
      conflicts.length > 0 ? `多講且講錯：${conflicts.join("；")}` : null,
    ].filter(Boolean);
    return { verdict: "MISMATCH", reason: parts.join("。"), coverage };
  }

  // 一個關鍵答案都沒講到（例如回「不知道」、答非所問）不算部分一致
  if (points.length > 0 && coverage === 0) {
    return { verdict: "MISMATCH", reason: "沒有講到任何關鍵答案", coverage };
  }

  const missingRequired = points.filter((p) => p.required && p.status !== "COVERED");
  const minorWrong = wrong.filter((p) => !p.required);
  const belowCoverage = coverage < options.minCoverage;
  if (missingRequired.length === 0 && minorWrong.length === 0 && !belowCoverage) {
    return { verdict: "MATCH", reason: null, coverage };
  }
  const parts = [
    missingRequired.length > 0 ? `必要的關鍵答案沒講到：${missingRequired.map((p) => p.text).join("；")}` : null,
    minorWrong.length > 0 ? `次要的講錯：${minorWrong.map((p) => p.text).join("；")}` : null,
    belowCoverage ? `涵蓋率 ${coverage}% 未達 ${options.minCoverage}%` : null,
  ].filter(Boolean);
  return { verdict: "PARTIAL", reason: parts.join("。"), coverage };
}
