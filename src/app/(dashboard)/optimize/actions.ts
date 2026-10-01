"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { BotTokenError, getBotTestTarget, type BotTestTarget } from "@/lib/botTest";
import { resolveTokenInput, type TokenCredentials } from "@/lib/telligentAuth";
import { cleanAiModel } from "@/lib/aiModels";
import { KnowledgeApiError, learnKnowledge } from "@/lib/telligentKb";
import {
  ACTIVE_JOB_STATUSES,
  clearRecordedBackendKnowledge,
  isJobLoopRunning,
  launchOptimizationJob,
  isDocVersion,
  uploadVersionToBackend,
} from "@/lib/optimizationRunner";

export type OptimizeActionResult = { success?: string; error?: string };

const PATH = "/optimize";

// 使用者貼的 token：access token 直接用；refresh token 先換一支 access token（同時驗證能不能用）
async function credentialsFor(target: BotTestTarget, raw: string): Promise<{ creds: TokenCredentials } | { error: string }> {
  try {
    return { creds: await resolveTokenInput(target, raw) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function errorMessage(err: unknown): string {
  if (err instanceof BotTokenError || err instanceof KnowledgeApiError) return err.message;
  return err instanceof Error ? err.message : "未知錯誤";
}

async function companyRoleIds(companyId: string): Promise<string[]> {
  return (await prisma.role.findMany({ where: { companyId }, select: { id: true } })).map((r) => r.id);
}

// 同一間公司同時只能有一個進行中的任務（大家共用同一個後台知識庫，同時跑會互相干擾）
async function activeJobInCompany(companyId: string) {
  return prisma.optimizationJob.findFirst({
    where: { roleId: { in: await companyRoleIds(companyId) }, status: { in: ACTIVE_JOB_STATUSES } },
    select: { id: true },
  });
}

// 這個角色的下一個任務流水號（版本名稱 v{流水號}.{輪次}）。
// 任務刪掉後版本還在，所以也要看既有版本名稱用過的號碼，避免新舊版本同名
async function nextJobSeq(roleId: string): Promise<number> {
  const [agg, versions] = await Promise.all([
    prisma.optimizationJob.aggregate({ where: { roleId }, _max: { seq: true } }),
    prisma.kbVersion.findMany({ where: { roleId, name: { startsWith: "v" } }, select: { name: true } }),
  ]);
  const usedInNames = versions.reduce((max, v) => Math.max(max, Number(v.name.match(/^v(\d+)\./)?.[1] ?? 0)), 0);
  return Math.max(agg._max.seq ?? 0, usedInNames) + 1;
}

async function knowledgeTarget(companyId: string) {
  const target = await getBotTestTarget(companyId);
  if (!target) return { error: "這間公司還沒設定機器人測試 API，請聯絡平台管理員。" } as const;
  if (!target.knowledgePlatformId) return { error: "這間公司還沒設定知識庫 platformId，請聯絡平台管理員到公司設定補上。" } as const;
  return { target } as const;
}

export async function startOptimizationAction(input: {
  scope: "SOURCE" | "KNOWLEDGE";
  sourceId: string;
  contentKind: "FAQ" | "DOC";
  questionSource: "ENTRIES" | "TEST_BANK";
  maxRuns: number;
  targetScore: number;
  similarCount: number;
  stallRuns: number;
  learnWaitMinutes: number;
  judgeModel: string;
  reviseModel: string;
  similarModel: string;
  token: string;
}): Promise<OptimizeActionResult> {
  const session = await requireCompanyUser();
  const t = await knowledgeTarget(session.companyId);
  if ("error" in t) return { error: t.error };
  if (await activeJobInCompany(session.companyId)) return { error: "這間公司已經有進行中（或暫停中）的自動優化，請先等它跑完或停止。" };
  const tk = await credentialsFor(t.target, input.token);
  if ("error" in tk) return { error: tk.error };

  const scope = input.scope === "KNOWLEDGE" ? "KNOWLEDGE" : "SOURCE";
  const contentKind = input.contentKind === "DOC" ? "DOC" : "FAQ";
  const questionSource = input.questionSource === "TEST_BANK" ? "TEST_BANK" : "ENTRIES";
  const sourceId = input.sourceId || null;

  if (scope === "SOURCE" && !sourceId) return { error: "請選擇一個 KM 來源。" };
  if (sourceId) {
    const source = await prisma.kmSource.findUnique({ where: { id: sourceId }, select: { roleId: true } });
    if (!source || source.roleId !== session.roleId) return { error: "找不到這個來源。" };
  }

  // 範圍：KM 來源＝這個來源的全部題目；知識列表＝已加入知識列表的題目（可再篩來源）
  const entries = await prisma.kmEntry.findMany({
    where: {
      roleId: session.roleId,
      ...(scope === "KNOWLEDGE" ? { confirmed: true } : {}),
      ...(sourceId ? { sourceId } : {}),
    },
    select: { id: true, kind: true },
  });
  if (!entries.some((e) => e.kind === contentKind)) {
    return { error: contentKind === "DOC" ? "這個範圍沒有結構化文件，請先產生結構化文件。" : "這個範圍沒有 FAQ。" };
  }
  if (questionSource === "ENTRIES" && !entries.some((e) => e.kind === "FAQ")) return { error: "這個範圍沒有 FAQ 可以當測試題目，請改用測試題庫。" };
  if (questionSource === "TEST_BANK" && (await prisma.testCase.count({ where: { roleId: session.roleId, archived: false } })) === 0) {
    return { error: "測試題庫是空的，請先到知識列表的「測試題庫」新增題目。" };
  }

  const job = await prisma.optimizationJob.create({
    data: {
      roleId: session.roleId,
      seq: await nextJobSeq(session.roleId),
      scope,
      sourceId,
      entryIds: entries.map((e) => e.id),
      createdById: session.id,
      contentKind,
      questionSource,
      maxRuns: clamp(input.maxRuns, 1, 10, 5),
      targetScore: clamp(input.targetScore, 1, 100, 90),
      similarCount: clamp(input.similarCount, 0, 5, 1),
      stallRuns: clamp(input.stallRuns, 1, 10, 2),
      learnWaitMinutes: clamp(input.learnWaitMinutes, 0, 30, 5),
      judgeModel: cleanAiModel(input.judgeModel),
      reviseModel: cleanAiModel(input.reviseModel),
      similarModel: cleanAiModel(input.similarModel),
      currentStep: "排隊中",
    },
  });
  launchOptimizationJob(job.id, tk.creds);

  revalidatePath(PATH);
  return { success: "已開始自動優化，可以關掉頁面，晚點回來看結果。" };
}

// 從某個版本繼續優化：範圍、內容類型、題目（含相似題）都沿用起點版本所屬的任務，只重設輪數與停止條件
export async function continueOptimizationAction(input: {
  baseVersionId: string;
  maxRuns: number;
  targetScore: number;
  stallRuns: number;
  learnWaitMinutes: number;
  judgeModel: string;
  reviseModel: string;
  token: string;
}): Promise<OptimizeActionResult> {
  const session = await requireCompanyUser();
  const base = await prisma.kbVersion.findUnique({ where: { id: input.baseVersionId }, include: { job: true } });
  if (!base || base.roleId !== session.roleId) return { error: "找不到這個版本。" };
  if (!base.job) return { error: "這個版本的原任務已被刪除，沒有可以沿用的題目，請改從 KM 內容開始新的自動優化。" };
  const t = await knowledgeTarget(session.companyId);
  if ("error" in t) return { error: t.error };
  if (await activeJobInCompany(session.companyId)) return { error: "這間公司已經有進行中（或暫停中）的自動優化，請先等它跑完或停止。" };
  const tk = await credentialsFor(t.target, input.token);
  if ("error" in tk) return { error: tk.error };

  const from = base.job;
  const job = await prisma.optimizationJob.create({
    data: {
      roleId: session.roleId,
      seq: await nextJobSeq(session.roleId),
      baseVersionId: base.id,
      scope: from.scope,
      sourceId: from.sourceId,
      entryIds: from.entryIds ?? [],
      createdById: session.id,
      contentKind: from.contentKind,
      questionSource: from.questionSource,
      maxRuns: clamp(input.maxRuns, 1, 10, 3),
      targetScore: clamp(input.targetScore, 1, 100, from.targetScore),
      similarCount: from.similarCount,
      stallRuns: clamp(input.stallRuns, 1, 10, from.stallRuns),
      learnWaitMinutes: clamp(input.learnWaitMinutes, 0, 30, from.learnWaitMinutes),
      judgeModel: cleanAiModel(input.judgeModel),
      reviseModel: cleanAiModel(input.reviseModel),
      // 題目沿用起點版本，不會再產生相似題
      similarModel: from.similarModel,
      currentStep: "排隊中",
    },
  });
  launchOptimizationJob(job.id, tk.creds);
  revalidatePath(PATH);
  return { success: `已從「${base.name}」開始繼續優化。` };
}

async function ownJob(jobId: string, roleId: string) {
  const job = await prisma.optimizationJob.findUnique({ where: { id: jobId } });
  return job && job.roleId === roleId ? job : null;
}

export async function stopOptimizationAction(jobId: string): Promise<OptimizeActionResult> {
  const session = await requireCompanyUser();
  const job = await ownJob(jobId, session.roleId);
  if (!job) return { error: "找不到這個任務。" };
  if (["DONE", "STOPPED"].includes(job.status)) return { error: "這個任務已經結束了。" };

  if (job.status === "RUNNING" && isJobLoopRunning(jobId)) {
    // 正在跑：做完手上這一題／這一步就停（後台學習的等待也會中斷）
    await prisma.optimizationJob.update({ where: { id: jobId }, data: { stopRequested: true, currentStep: "停止中…" } });
    revalidatePath(PATH);
    return { success: "已送出停止，做完手上的步驟就會停下來。" };
  }
  await prisma.optimizationJob.update({
    where: { id: jobId },
    data: { status: "STOPPED", stopRequested: true, stopReason: "使用者停止", currentStep: "已停止" },
  });
  revalidatePath(PATH);
  return { success: "已停止。" };
}

// 暫停（token 過期、伺服器重啟）或失敗後，貼新的 token 從中斷的那一步繼續
export async function resumeOptimizationAction(jobId: string, rawToken: string): Promise<OptimizeActionResult> {
  const session = await requireCompanyUser();
  const job = await ownJob(jobId, session.roleId);
  if (!job) return { error: "找不到這個任務。" };
  const t = await knowledgeTarget(session.companyId);
  if ("error" in t) return { error: t.error };
  const tk = await credentialsFor(t.target, rawToken);
  if ("error" in tk) return { error: tk.error };

  if (job.status === "RUNNING") {
    if (isJobLoopRunning(jobId)) {
      launchOptimizationJob(jobId, tk.creds); // 只換 token
      return { success: "已更新 token。" };
    }
  } else if (!["PAUSED_TOKEN", "FAILED"].includes(job.status)) {
    return { error: "這個任務已經結束，不能繼續。" };
  }

  await prisma.optimizationJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", stopRequested: false, errorMessage: null, currentStep: "繼續執行中" },
  });
  launchOptimizationJob(jobId, tk.creds);
  revalidatePath(PATH);
  return { success: "已繼續執行。" };
}

export async function deleteOptimizationJobAction(jobId: string): Promise<OptimizeActionResult> {
  const session = await requireCompanyUser();
  const job = await ownJob(jobId, session.roleId);
  if (!job) return { error: "找不到這個任務。" };
  if (ACTIVE_JOB_STATUSES.includes(job.status)) return { error: "請先停止這個任務再刪除。" };
  // 只刪任務紀錄與題目；每一輪的版本保留在知識列表的「版本」分頁
  await prisma.optimizationJob.delete({ where: { id: jobId } });
  revalidatePath(PATH);
  return { success: "已刪除任務紀錄（各輪版本仍保留在知識列表的「版本」分頁）。" };
}

// 把挑中的版本放到後台：先刪掉 AIBPO 先前上傳的那批 → 上傳這一版 → 送出學習
export async function deployVersionAction(versionId: string, rawToken: string): Promise<OptimizeActionResult> {
  const session = await requireCompanyUser();
  const version = await prisma.kbVersion.findUnique({ where: { id: versionId } });
  if (!version || version.roleId !== session.roleId) return { error: "找不到這個版本。" };
  const t = await knowledgeTarget(session.companyId);
  if ("error" in t) return { error: t.error };
  if (await activeJobInCompany(session.companyId)) return { error: "有進行中（或暫停中）的自動優化，請先停止再部署。" };
  const tk = await credentialsFor(t.target, rawToken);
  if ("error" in tk) return { error: tk.error };
  const token = tk.creds.accessToken;

  try {
    await clearRecordedBackendKnowledge({ companyId: session.companyId, target: t.target, token, exceptVersionId: version.id });
    const ids = await uploadVersionToBackend({ target: t.target, token, version, label: version.name, splitByH1: await isDocVersion(version) });
    try {
      await learnKnowledge(t.target, token, ids);
    } catch (err) {
      if (!(err instanceof KnowledgeApiError)) throw err;
    }
  } catch (err) {
    return { error: `部署失敗：${errorMessage(err)}` };
  }
  revalidatePath(PATH);
  return { success: `已把「${version.name}」上傳到後台並送出學習，學習完成後機器人就會用這一版回答。` };
}

// 把 AIBPO 上傳到後台的知識全部移除（不碰後台原有的知識）
export async function clearBackendAction(rawToken: string): Promise<OptimizeActionResult> {
  const session = await requireCompanyUser();
  const t = await knowledgeTarget(session.companyId);
  if ("error" in t) return { error: t.error };
  if (await activeJobInCompany(session.companyId)) return { error: "有進行中（或暫停中）的自動優化，請先停止。" };
  const tk = await credentialsFor(t.target, rawToken);
  if ("error" in tk) return { error: tk.error };
  const token = tk.creds.accessToken;
  try {
    const count = await clearRecordedBackendKnowledge({ companyId: session.companyId, target: t.target, token });
    revalidatePath(PATH);
    return { success: count > 0 ? `已從後台移除 AIBPO 上傳的 ${count} 筆知識。` : "後台沒有 AIBPO 上傳的知識。" };
  } catch (err) {
    return { error: `移除失敗：${errorMessage(err)}` };
  }
}

export type RunResultView = {
  order: number;
  question: string;
  expectedAnswer: string;
  botAnswer: string | null;
  isSimilar: boolean;
  verdict: string | null;
  reason: string | null;
};

// 某一輪的逐題結果（展開時才載入）
export async function getRunResultsAction(versionId: string): Promise<RunResultView[]> {
  const session = await requireCompanyUser();
  const version = await prisma.kbVersion.findUnique({ where: { id: versionId }, select: { roleId: true } });
  if (!version || version.roleId !== session.roleId) return [];
  const run = await prisma.versionTestRun.findFirst({
    where: { versionId },
    orderBy: { createdAt: "desc" },
    include: { results: { orderBy: { order: "asc" }, include: { jobQuestion: { select: { isSimilar: true } } } } },
  });
  return (run?.results ?? []).map((r) => ({
    order: r.order,
    question: r.question,
    expectedAnswer: r.expectedAnswer,
    botAnswer: r.botAnswer,
    isSimilar: r.jobQuestion?.isSimilar ?? false,
    verdict: r.judgeVerdict,
    reason: r.judgeReason ?? r.errorMessage,
  }));
}

export type CompareSide = {
  id: string;
  name: string;
  markdown: string;
  scoreAll: number | null;
  scoreOriginal: number | null;
  scoreSimilar: number | null;
  results: RunResultView[];
};

// 版本比較：兩個版本的 md 全文與逐題結果（畫面上算 md 差異、對齊題目）
export async function compareVersionsAction(versionIds: [string, string]): Promise<{ sides?: [CompareSide, CompareSide]; error?: string }> {
  const session = await requireCompanyUser();
  const versions = await prisma.kbVersion.findMany({
    where: { id: { in: versionIds }, roleId: session.roleId },
    include: {
      testRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { results: { orderBy: { order: "asc" }, include: { jobQuestion: { select: { isSimilar: true } } } } },
      },
    },
  });
  if (versions.length !== 2) return { error: "找不到要比較的版本。" };
  const toSide = (v: (typeof versions)[number]): CompareSide => ({
    id: v.id,
    name: v.name,
    markdown: v.markdown,
    scoreAll: v.scoreAll,
    scoreOriginal: v.scoreOriginal,
    scoreSimilar: v.scoreSimilar,
    results: (v.testRuns[0]?.results ?? []).map((r) => ({
      order: r.order,
      question: r.question,
      expectedAnswer: r.expectedAnswer,
      botAnswer: r.botAnswer,
      isSimilar: r.jobQuestion?.isSimilar ?? false,
      verdict: r.judgeVerdict,
      reason: r.judgeReason ?? r.errorMessage,
    })),
  });
  // 依傳入順序回傳（舊版在前）
  const byId = new Map(versions.map((v) => [v.id, toSide(v)]));
  return { sides: [byId.get(versionIds[0])!, byId.get(versionIds[1])!] };
}
