import { prisma } from "@/lib/db";
import type { JudgeDetail } from "@/lib/keyPoints";
import type { RevisionLog } from "@/lib/optimizationPrompts";

// 自動優化的「待處理清單」：AI 改 md 解決不了、需要人處理的題目（只看原題）。
// 以這個任務正確率最高的版本為準：那一版已經答對的不列。
// - 原文就沒有：AI 診斷為 NOT_IN_SOURCE → 要補來源檔案
// - 機器人本身的問題：最近一次診斷為 RETRIEVAL → 請後台檢查檢索或設定
// - 關鍵答案可能太嚴：好幾個版本都漏同一個必要點，而且其他重點都有講到 → 考慮把那一點改成次要
// - 還在處理：其他還沒答對的題目，AI 之後幾輪會繼續修

export type TodoQuestion = {
  question: string;
  expectedAnswer: string;
  botAnswer: string | null;
  verdict: string | null;
  // AI 的診斷說明（原文沒有缺什麼、為什麼判斷是機器人的問題）
  note: string | null;
  diagnosedIn: string | null;
};

export type TodoStrictPoint = {
  question: string;
  expectedAnswer: string;
  point: string;
  // 幾個測過的版本都漏了這一點
  missedIn: number;
  testedVersions: number;
  botAnswer: string | null;
};

export type JobTodo = {
  bestVersionName: string | null;
  bestScore: number | null;
  testedVersions: number;
  notInSource: TodoQuestion[];
  retrieval: TodoQuestion[];
  strictKeyPoints: TodoStrictPoint[];
  stillWorking: TodoQuestion[];
};

export async function computeJobTodo(jobId: string): Promise<JobTodo | null> {
  const versions = await prisma.kbVersion.findMany({
    where: { jobId },
    orderBy: [{ runIndex: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      scoreAll: true,
      scoreCoverage: true,
      createdAt: true,
      revisionLog: true,
      testRuns: {
        where: { status: "DONE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { results: { include: { jobQuestion: { select: { isSimilar: true } } } } },
      },
    },
  });
  const tested = versions.filter((v) => v.scoreAll !== null && v.testRuns.length > 0);
  if (tested.length === 0) return null;
  const best = [...tested].sort(
    (a, b) => (b.scoreAll ?? 0) - (a.scoreAll ?? 0) || (b.scoreCoverage ?? 0) - (a.scoreCoverage ?? 0) || b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  const shortName = (name: string) => name.split("・")[0];

  // 每一題最近一次的診斷（版本依輪次排序，後面的蓋掉前面的）
  const lastDiagnosis = new Map<string, { cause: string; note: string; version: string }>();
  const everNotInSource = new Map<string, { note: string; version: string }>();
  for (const v of versions) {
    const log = v.revisionLog as RevisionLog | null;
    for (const d of log?.diagnoses ?? []) {
      const key = d.question.trim();
      lastDiagnosis.set(key, { cause: d.cause, note: d.note, version: shortName(v.name) });
      if (d.cause === "NOT_IN_SOURCE") everNotInSource.set(key, { note: d.note, version: shortName(v.name) });
    }
  }

  // 每個版本裡，每題漏掉的必要點
  const missingByVersion = tested.map((v) => {
    const map = new Map<string, Set<string>>();
    for (const r of v.testRuns[0].results) {
      if (r.jobQuestion?.isSimilar) continue;
      const detail = r.judgeDetail as JudgeDetail | null;
      map.set(r.question.trim(), new Set((detail?.points ?? []).filter((p) => p.required && p.status === "MISSING").map((p) => p.text)));
    }
    return map;
  });

  const todo: JobTodo = {
    bestVersionName: shortName(best.name),
    bestScore: best.scoreAll,
    testedVersions: tested.length,
    notInSource: [],
    retrieval: [],
    strictKeyPoints: [],
    stillWorking: [],
  };
  const threshold = Math.min(2, tested.length);

  for (const r of best.testRuns[0].results) {
    if (r.jobQuestion?.isSimilar || r.judgeVerdict === "MATCH") continue;
    const key = r.question.trim();
    const detail = r.judgeDetail as JudgeDetail | null;
    const base = { question: r.question, expectedAnswer: r.expectedAnswer, botAnswer: r.botAnswer, verdict: r.judgeVerdict };
    const nis = everNotInSource.get(key);
    const last = lastDiagnosis.get(key);
    if (nis) {
      todo.notInSource.push({ ...base, note: nis.note, diagnosedIn: nis.version });
      continue;
    }
    if (last?.cause === "RETRIEVAL") {
      todo.retrieval.push({ ...base, note: last.note, diagnosedIn: last.version });
      continue;
    }
    // 部分一致、沒講錯、只漏了少數必要點，而且好幾個版本都漏同一點 → 關鍵答案可能標得太嚴
    const points = detail?.points ?? [];
    const missingNow = points.filter((p) => p.required && p.status === "MISSING");
    const coveredOthers = points.some((p) => p.status === "COVERED");
    const noWrong = !points.some((p) => p.status === "WRONG") && (detail?.conflicts.length ?? 0) === 0;
    let strict = false;
    if (r.judgeVerdict === "PARTIAL" && noWrong && coveredOthers && missingNow.length > 0 && missingNow.length <= 2) {
      for (const p of missingNow) {
        const missedIn = missingByVersion.filter((m) => m.get(key)?.has(p.text)).length;
        if (missedIn >= threshold) {
          todo.strictKeyPoints.push({ question: r.question, expectedAnswer: r.expectedAnswer, point: p.text, missedIn, testedVersions: tested.length, botAnswer: r.botAnswer });
          strict = true;
        }
      }
    }
    if (strict) continue;
    todo.stillWorking.push({ ...base, note: last?.note ?? null, diagnosedIn: last?.version ?? null });
  }
  return todo;
}

export function todoSummary(todo: JobTodo): string {
  const parts = [
    todo.notInSource.length > 0 ? `原文沒有 ${todo.notInSource.length} 題` : "",
    todo.retrieval.length > 0 ? `機器人問題 ${todo.retrieval.length} 題` : "",
    todo.strictKeyPoints.length > 0 ? `關鍵答案可能太嚴 ${todo.strictKeyPoints.length} 項` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `待處理：${parts.join("、")}（到自動優化頁的「待處理清單」查看）` : "";
}
