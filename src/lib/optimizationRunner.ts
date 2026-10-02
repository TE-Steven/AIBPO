import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { Prisma, type KmSource, type OptimizationJob } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { anthropic, recordApiUsage } from "@/lib/anthropic";
import { findAiModel } from "@/lib/aiModels";
import { companyIdForRole } from "@/lib/company";
import { askBot, BotTokenError, getBotTestTarget, readTokenCompany, tokenExpiresAt, type BotTestTarget } from "@/lib/botTest";
import { runBotJobs, TOKEN_SKIPPED_MESSAGE } from "@/lib/botTestRunner";
import { refreshAccessToken, type TokenCredentials } from "@/lib/telligentAuth";
import { getPromptConfig } from "@/lib/promptConfigStore";
import { resolveOptions, type PromptConfigData } from "@/lib/promptConfig";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { buildKnowledgeMarkdown, tallyPathOf, type ExportEntry } from "@/lib/kmExport";
import { buildTallyDocumentsMarkdown } from "@/lib/tallyDocumentsExport";
import { getSourceFiles, getSourceUrls } from "@/lib/kmAnalysis";
import { tallyPathOptions } from "@/lib/tallyTree";
import { splitMarkdownByH1 } from "@/lib/markdownSplit";
import {
  buildEditSystemPrompt,
  buildEditUserText,
  buildRevisionSystemPrompt,
  buildRevisionUserText,
  buildSimilarQuestionsSystemPrompt,
  EDIT_CAUSE_LABELS,
  EDIT_SCHEMA,
  SIMILAR_QUESTIONS_SCHEMA,
  type EditCause,
  type EditFailure,
  type RevisionLog,
} from "@/lib/optimizationPrompts";
import { applyMdEdits, type MdEdit } from "@/lib/mdEdits";
import type { JudgeDetail } from "@/lib/keyPoints";
import {
  createKnowledge,
  deleteKnowledge,
  AIBPO_KNOWLEDGE_PREFIX,
  DELETING_STATUS,
  findKnowledgeByName,
  isLearned,
  listKnowledge,
  KnowledgeApiError,
  learnKnowledge,
  uploadMarkdown,
  waitUntilDeleted,
  waitUntilAllLearned,
} from "@/lib/telligentKb";

// 自動優化的背景迴圈：每一輪 上傳 md → 後台學習 → 全部題目問機器人＋AI 比對 → 算分 → 沒達標就請 Claude 依答錯清單改整份 md。
// 每一步做完都寫回 DB（resumeStep），所以暫停（token 過期、伺服器重啟）後貼新 token 可以從中斷的那一步繼續。
// token 只放在這個行程的記憶體裡，不進 DB；伺服器重啟時 instrumentation 會把 RUNNING 的任務標成 PAUSED_TOKEN。
// 貼的是 refresh token 時，access token 快過期就自動換新的，不用暫停。

// 跟 Prisma client 一樣掛在 globalThis：開發模式熱更新後，server action 跟背景迴圈仍然看得到同一份
type RunnerState = { tokens: Map<string, TokenCredentials>; running: Set<string> };
const globalForRunner = globalThis as unknown as { aibpoOptimization?: RunnerState };
const state: RunnerState = (globalForRunner.aibpoOptimization ??= { tokens: new Map(), running: new Set() });

// 沒有 refresh token 時：access token 剩不到這麼久就先暫停，避免做到一半才失效
const TOKEN_MIN_REMAINING_MS = 3 * 60_000;
// 有 refresh token 時：每一步開始前，剩不到這麼久就先換新的（一步最長約 20 分鐘）
const TOKEN_REFRESH_BEFORE_MS = 30 * 60_000;

export const ACTIVE_JOB_STATUSES = ["RUNNING", "PAUSED_TOKEN"];

export function isJobLoopRunning(jobId: string): boolean {
  return state.running.has(jobId);
}

// 啟動（或繼續）一個任務的背景迴圈；已經在跑就只更新 token
export function launchOptimizationJob(jobId: string, creds: TokenCredentials): void {
  state.tokens.set(jobId, creds);
  if (state.running.has(jobId)) return;
  state.running.add(jobId);
  void runLoop(jobId)
    .catch(async (err) => {
      await prisma.optimizationJob
        .update({ where: { id: jobId }, data: { status: "FAILED", errorMessage: errorText(err), currentStep: "發生錯誤，已停止" } })
        .catch(() => {});
    })
    .finally(() => {
      state.running.delete(jobId);
      state.tokens.delete(jobId);
    });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "未知錯誤";
}

// 版本名稱：v{第幾次優化}.{輪次}・範圍，例如「v3.2・三產品測試」
export function versionName(job: Pick<OptimizationJob, "seq">, label: string, runIndex: number): string {
  return `v${job.seq}.${runIndex}・${label}`;
}

export function jobLabel(job: Pick<OptimizationJob, "scope">, source: Pick<KmSource, "title"> | null): string {
  if (job.scope === "SOURCE") return source?.title ?? "（來源已刪除）";
  return source ? `知識列表・${source.title}` : "知識列表・全部";
}

async function setStep(jobId: string, currentStep: string) {
  await prisma.optimizationJob.update({ where: { id: jobId }, data: { currentStep } });
}

async function isStopRequested(jobId: string): Promise<boolean> {
  const job = await prisma.optimizationJob.findUnique({ where: { id: jobId }, select: { stopRequested: true } });
  return !job || job.stopRequested;
}

async function pause(jobId: string, message: string) {
  await prisma.optimizationJob.update({ where: { id: jobId }, data: { status: "PAUSED_TOKEN", currentStep: message } });
}

// 有 refresh token 就換一支新的 access token（refresh token 也會換新，要存回去）
async function refreshJobToken(jobId: string, creds: TokenCredentials, target: BotTestTarget): Promise<TokenCredentials> {
  if (!creds.refreshToken) throw new BotTokenError("token 已過期，請貼新的 token 繼續。");
  const next = await refreshAccessToken(target, creds.refreshToken, readTokenCompany(creds.accessToken));
  state.tokens.set(jobId, next);
  return next;
}

async function runLoop(jobId: string): Promise<void> {
  let lastForcedRefresh = 0;
  for (;;) {
    const job = await prisma.optimizationJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING") return;
    if (job.stopRequested) {
      await prisma.optimizationJob.update({ where: { id: jobId }, data: { status: "STOPPED", stopReason: "使用者停止", currentStep: "已停止" } });
      return;
    }
    let creds = state.tokens.get(jobId);
    if (!creds) {
      await pause(jobId, "token 不在伺服器記憶體裡（可能伺服器重新啟動），請貼新的 token 繼續。");
      return;
    }

    try {
      const ctx = await loadContext(job);
      const exp = tokenExpiresAt(creds.accessToken);
      const remaining = exp ? exp - Date.now() : Number.POSITIVE_INFINITY;
      if (creds.refreshToken && remaining < TOKEN_REFRESH_BEFORE_MS) {
        creds = await refreshJobToken(jobId, creds, ctx.target);
      } else if (!creds.refreshToken && remaining < TOKEN_MIN_REMAINING_MS) {
        await pause(jobId, "token 快過期了，請貼新的 token 繼續。");
        return;
      }
      const token = creds.accessToken;
      if (job.resumeStep === "PREPARE") await stepPrepare(job, ctx);
      else if (job.resumeStep === "UPLOAD") await stepUpload(job, ctx, token);
      else if (job.resumeStep === "TEST") await stepTest(job, ctx, token);
      else if (job.resumeStep === "REVISE") await stepRevise(job, ctx);
      else throw new Error(`不認得的步驟 ${job.resumeStep}`);
    } catch (err) {
      if (err instanceof BotTokenError) {
        // 做到一半 token 失效：有 refresh token 就換新的再從這一步繼續（剛換過還失效就不再硬換，改暫停）
        if (creds.refreshToken && Date.now() - lastForcedRefresh > 2 * 60_000) {
          lastForcedRefresh = Date.now();
          try {
            const target = (await loadContext(job)).target;
            await refreshJobToken(jobId, creds, target);
            continue;
          } catch (refreshErr) {
            await pause(jobId, `${errorText(refreshErr)}（貼新的 token 會從這一步繼續）`);
            return;
          }
        }
        await pause(jobId, `${err.message}（貼新的 token 會從這一步繼續）`);
        return;
      }
      // 按了停止時，等學習或問機器人的流程會丟錯中斷：這種情況算停止，不算失敗
      if (await isStopRequested(jobId)) continue;
      await prisma.optimizationJob.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage: errorText(err), currentStep: "發生錯誤，已暫停（可以貼 token 從這一步重試）" },
      });
      return;
    }
  }
}

type JobContext = {
  companyId: string;
  target: BotTestTarget;
  config: PromptConfigData;
  guidelines: string;
};

async function loadContext(job: OptimizationJob): Promise<JobContext> {
  const companyId = await companyIdForRole(job.roleId);
  const [target, config, guidelines] = await Promise.all([
    getBotTestTarget(companyId),
    getPromptConfig(companyId),
    getSystemSetting(companyId, KM_OUTPUT_GUIDELINES_KEY),
  ]);
  if (!target) throw new Error("這間公司還沒設定機器人測試 API，請聯絡平台管理員。");
  if (!target.knowledgePlatformId) throw new Error("這間公司還沒設定知識庫 platformId，請聯絡平台管理員到公司設定補上。");
  return { companyId, target, config, guidelines: guidelines ?? "" };
}

function asIds(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

async function versionSettings(job: OptimizationJob, ctx: JobContext, runIndex: number) {
  const tallies = await prisma.tally.findMany({ where: { roleId: job.roleId }, orderBy: { order: "asc" } });
  return {
    promptConfig: ctx.config as object,
    guidelines: ctx.guidelines,
    tallies: tallyPathOptions(tallies).map((t) => ({ path: t.path, description: t.description })),
    optimization: { jobId: job.id, runIndex },
  };
}

// ---------------- 第 1 輪前：初始 md、題目、相似題 ----------------

async function stepPrepare(job: OptimizationJob, ctx: JobContext) {
  if (job.baseVersionId) return prepareFromBase(job, ctx, job.baseVersionId);
  await setStep(job.id, "準備中：組初始 md、整理題目");
  const entryIds = asIds(job.entryIds);
  const entries = await prisma.kmEntry.findMany({
    where: { id: { in: entryIds }, roleId: job.roleId },
    include: { tally: { include: { parent: { include: { parent: true } } } }, source: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });
  const contentEntries = entries.filter((e) => e.kind === job.contentKind);
  if (contentEntries.length === 0) {
    throw new Error(job.contentKind === "DOC" ? "選擇的範圍沒有結構化文件，請先產生結構化文件。" : "選擇的範圍沒有 FAQ。");
  }

  const source = job.sourceId ? await prisma.kmSource.findUnique({ where: { id: job.sourceId } }) : null;
  const label = jobLabel(job, source);
  const snapshot: ExportEntry[] = contentEntries.map((e) => ({
    kind: e.kind,
    question: e.question,
    answer: e.answer,
    tallyPath: tallyPathOf(e.tally),
    sourceTitle: e.source.title,
  }));
  const options = resolveOptions(ctx.config);
  let markdown: string;
  if (job.contentKind === "DOC") {
    const templates = await prisma.tally.findMany({ where: { roleId: job.roleId, parentId: null }, select: { id: true, order: true, name: true } });
    markdown = buildTallyDocumentsMarkdown(contentEntries, templates, options.docSelfContainedHeadings);
  } else {
    markdown = buildKnowledgeMarkdown({ entries: snapshot, options, format: "md", exportedAt: new Date(), title: label });
  }

  // 題目：範圍內的 FAQ，或公司的固定測試題庫
  const originals =
    job.questionSource === "TEST_BANK"
      ? (
          await prisma.testCase.findMany({ where: { roleId: job.roleId, archived: false }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] })
        ).map((t) => ({ question: t.question, expectedAnswer: t.expectedAnswer }))
      : entries.filter((e) => e.kind === "FAQ").map((e) => ({ question: e.question, expectedAnswer: e.answer }));
  if (originals.length === 0) {
    throw new Error(job.questionSource === "TEST_BANK" ? "測試題庫是空的。" : "選擇的範圍沒有 FAQ 可以當測試題目。");
  }

  let similar: string[][] = [];
  if (job.similarCount > 0) {
    await setStep(job.id, `準備中：AI 為 ${originals.length} 題各產生 ${job.similarCount} 個相似問法`);
    similar = await generateSimilarQuestions(originals, job.similarCount, ctx.config, job.roleId, job.similarModel);
  }

  const questionRows: Prisma.OptimizationQuestionCreateManyInput[] = [];
  let order = 0;
  for (const [i, q] of originals.entries()) {
    const id = randomUUID();
    questionRows.push({ id, jobId: job.id, order: ++order, question: q.question, expectedAnswer: q.expectedAnswer });
    for (const s of similar[i] ?? []) {
      questionRows.push({ jobId: job.id, order: ++order, question: s, expectedAnswer: q.expectedAnswer, isSimilar: true, parentId: id });
    }
  }

  const settings = await versionSettings(job, ctx, 1);
  await prisma.$transaction([
    // 重跑準備步驟（例如上次在這一步失敗）時先清掉上次的半成品；這時候還沒有上傳到後台
    prisma.optimizationQuestion.deleteMany({ where: { jobId: job.id } }),
    prisma.kbVersion.deleteMany({ where: { jobId: job.id } }),
    prisma.optimizationQuestion.createMany({ data: questionRows }),
    prisma.kbVersion.create({
      data: {
        roleId: job.roleId,
        name: versionName(job, label, 1),
        note: "自動優化第 1 輪：原始內容",
        createdById: job.createdById,
        markdown,
        entries: snapshot,
        entryCount: snapshot.length,
        settings,
        jobId: job.id,
        runIndex: 1,
      },
    }),
    prisma.optimizationJob.update({ where: { id: job.id }, data: { currentRun: 1, resumeStep: "UPLOAD", errorMessage: null } }),
  ]);
}

// 從某個版本繼續優化：沿用那一版的 md 與原任務的同一套題目（含相似題），分數才能跟之前的版本比較。
// 起點版本已經測過，就直接從它的答錯清單開始修改（起點版本當第 0 輪）；沒測過就先把它當第 1 輪上傳測試。
async function prepareFromBase(job: OptimizationJob, ctx: JobContext, baseVersionId: string) {
  await setStep(job.id, "準備中：沿用起點版本的 md 與題目");
  const base = await prisma.kbVersion.findUnique({
    where: { id: baseVersionId },
    include: { testRuns: { where: { status: "DONE" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  if (!base || base.roleId !== job.roleId) throw new Error("找不到起點版本，可能已被刪除。");
  const baseQuestions = base.jobId
    ? await prisma.optimizationQuestion.findMany({ where: { jobId: base.jobId }, orderBy: { order: "asc" } })
    : [];
  if (baseQuestions.length === 0) throw new Error("起點版本的題目已經不在了（原任務可能被刪除），請改從 KM 內容重新開始。");

  const idMap = new Map(baseQuestions.map((q) => [q.id, randomUUID()]));
  const questionRows: Prisma.OptimizationQuestionCreateManyInput[] = baseQuestions.map((q) => ({
    id: idMap.get(q.id),
    jobId: job.id,
    order: q.order,
    question: q.question,
    expectedAnswer: q.expectedAnswer,
    isSimilar: q.isSimilar,
    parentId: q.parentId ? (idMap.get(q.parentId) ?? null) : null,
  }));
  const reset = [
    prisma.optimizationQuestion.deleteMany({ where: { jobId: job.id } }),
    prisma.kbVersion.deleteMany({ where: { jobId: job.id } }),
    prisma.optimizationQuestion.createMany({ data: questionRows }),
  ];

  if (base.testRuns.length > 0) {
    await prisma.$transaction([
      ...reset,
      prisma.optimizationJob.update({
        where: { id: job.id },
        data: { currentRun: 0, resumeStep: "REVISE", errorMessage: null, currentStep: `從 ${base.name} 的答錯清單開始修改` },
      }),
    ]);
    return;
  }

  const source = job.sourceId ? await prisma.kmSource.findUnique({ where: { id: job.sourceId } }) : null;
  const settings = await versionSettings(job, ctx, 1);
  await prisma.$transaction([
    ...reset,
    prisma.kbVersion.create({
      data: {
        roleId: job.roleId,
        name: versionName(job, jobLabel(job, source), 1),
        note: `自動優化第 1 輪：沿用 ${base.name}`,
        createdById: job.createdById,
        markdown: base.markdown,
        entries: base.entries ?? [],
        entryCount: base.entryCount,
        settings,
        jobId: job.id,
        runIndex: 1,
      },
    }),
    prisma.optimizationJob.update({ where: { id: job.id }, data: { currentRun: 1, resumeStep: "UPLOAD", errorMessage: null } }),
  ]);
}

async function generateSimilarQuestions(
  originals: { question: string; expectedAnswer: string }[],
  count: number,
  config: PromptConfigData,
  roleId: string,
  model: string,
): Promise<string[][]> {
  const list = originals
    .map((q, i) => `<item index="${i + 1}">\n<question>${q.question}</question>\n<answer>${q.expectedAnswer}</answer>\n</item>`)
    .join("\n");
  const response = await anthropic.messages
    .stream({
      model,
      max_tokens: 32000,
      system: buildSimilarQuestionsSystemPrompt({ count, config }),
      output_config: {
        ...(findAiModel(model).effort ? { effort: "low" as const } : {}),
        format: { type: "json_schema", schema: SIMILAR_QUESTIONS_SCHEMA },
      },
      messages: [{ role: "user", content: `${list}\n\n請為以上每一題各寫 ${count} 個相似問法，index 對應題號。` }],
    })
    .finalMessage();
  await recordApiUsage({ model, purpose: "km_optimize_similar", usage: response.usage, roleId });
  if (response.stop_reason === "max_tokens") throw new Error("題目太多，相似題輸出被截斷，請減少題目或相似題數量。");

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { items: { index: number; questions: string[] }[] };
  const result: string[][] = originals.map(() => []);
  for (const item of parsed.items) {
    const i = item.index - 1;
    if (i < 0 || i >= originals.length) continue;
    const seen = new Set([originals[i].question.trim()]);
    for (const raw of item.questions) {
      const q = raw.trim();
      if (!q || seen.has(q) || result[i].length >= count) continue;
      seen.add(q);
      result[i].push(q);
    }
  }
  return result;
}

// ---------------- 上傳到後台、學習 ----------------

async function currentVersion(job: OptimizationJob) {
  const version = await prisma.kbVersion.findFirst({ where: { jobId: job.id, runIndex: job.currentRun } });
  if (!version) throw new Error(`找不到第 ${job.currentRun} 輪的版本。`);
  return version;
}

// 刪除這間公司裡 AIBPO 先前上傳、還留在後台的知識（只刪 AIBPO 自己記下的 id，不碰後台原有的知識）
export async function clearRecordedBackendKnowledge(params: {
  companyId: string;
  target: BotTestTarget;
  token: string;
  exceptVersionId?: string;
  waitDeleted?: boolean;
}): Promise<number> {
  const roles = await prisma.role.findMany({ where: { companyId: params.companyId }, select: { id: true } });
  const stale = await prisma.kbVersion.findMany({
    where: {
      roleId: { in: roles.map((r) => r.id) },
      backendKnowledgeIds: { not: Prisma.DbNull },
      ...(params.exceptVersionId ? { id: { not: params.exceptVersionId } } : {}),
    },
    select: { id: true, backendKnowledgeIds: true },
  });
  if (stale.length === 0) return 0;

  // 先查後台目前還有哪些：被人手動刪掉（或正在刪除中）的不再送刪除（送了會回 HTTP 400），只清掉 AIBPO 的紀錄
  const alive = new Map((await listKnowledge(params.target, params.token, AIBPO_KNOWLEDGE_PREFIX)).map((i) => [i.id, i]));
  const deletedIds: string[] = [];
  for (const v of stale) {
    const ids = asIds(v.backendKnowledgeIds).filter((id) => {
      const item = alive.get(id);
      return item && item.status !== DELETING_STATUS;
    });
    if (ids.length > 0) await deleteKnowledge(params.target, params.token, ids);
    await prisma.kbVersion.update({ where: { id: v.id }, data: { backendKnowledgeIds: Prisma.DbNull } });
    deletedIds.push(...ids);
  }
  // 後台刪除是非同步的：等它真的消失再往下做（例如上傳下一版），避免新舊兩版同時影響機器人回答
  if (deletedIds.length > 0 && params.waitDeleted) await waitUntilDeleted(params.target, params.token, deletedIds);
  return deletedIds.length;
}

export function backendKnowledgeName(label: string, versionId: string, runIndex: number | null): string {
  const safe = label.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  return `${AIBPO_KNOWLEDGE_PREFIX}${safe}-${versionId.slice(-6)}${runIndex ? `-r${runIndex}` : ""}`;
}

// 自動優化的結構化文件版本：上傳時一個 H1（一份文件）一個 md 檔
export async function isDocVersion(version: { jobId: string | null }): Promise<boolean> {
  if (!version.jobId) return false;
  const job = await prisma.optimizationJob.findUnique({ where: { id: version.jobId }, select: { contentKind: true } });
  return job?.contentKind === "DOC";
}

// 上傳一個版本到後台並新增知識，記下 id（之後只刪這一批）。已上傳過（例如中斷後繼續）就沿用。
// splitByH1：結構化文件依 H1 切成多個 md 檔各自上傳；FAQ 整份一個檔。
export async function uploadVersionToBackend(params: {
  target: BotTestTarget;
  token: string;
  version: { id: string; markdown: string; backendKnowledgeIds: Prisma.JsonValue | null; runIndex: number | null };
  label: string;
  splitByH1: boolean;
  onStep?: (step: string) => Promise<void>;
}): Promise<string[]> {
  const existingIds = asIds(params.version.backendKnowledgeIds);
  if (existingIds.length > 0) return existingIds;

  const base = backendKnowledgeName(params.label, params.version.id, params.version.runIndex);
  const parts = params.splitByH1
    ? splitMarkdownByH1(params.version.markdown).map((p, i) => ({
        name: `${base}-${String(i + 1).padStart(2, "0")}-${p.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 20)}`,
        content: p.content,
      }))
    : [{ name: base, content: params.version.markdown }];
  if (parts.length === 0) throw new Error("md 裡找不到任何 H1（# 標題），無法依文件切檔上傳。");

  const ids: string[] = [];
  for (const [i, part] of parts.entries()) {
    const progress = parts.length > 1 ? `（${i + 1}／${parts.length}）` : "";
    // 上次新增成功但還沒來得及記下 id 就中斷：用唯一名稱找回來，避免重複上傳
    let id = (await findKnowledgeByName(params.target, params.token, part.name))?.id;
    if (!id) {
      await params.onStep?.(`上傳 md 到後台${progress}`);
      const url = await uploadMarkdown(params.target, params.token, part.content, `${part.name}.md`);
      id = await createKnowledge(params.target, params.token, { name: part.name, url, sourceName: `${part.name}.md` });
    }
    ids.push(id);
  }
  await prisma.kbVersion.update({ where: { id: params.version.id }, data: { backendKnowledgeIds: ids } });
  return ids;
}

async function stepUpload(job: OptimizationJob, ctx: JobContext, token: string) {
  const n = job.currentRun;
  const version = await currentVersion(job);
  const source = job.sourceId ? await prisma.kmSource.findUnique({ where: { id: job.sourceId } }) : null;

  if (asIds(version.backendKnowledgeIds).length === 0) {
    await setStep(job.id, `第 ${n} 輪：刪除後台上一版`);
    await clearRecordedBackendKnowledge({ companyId: ctx.companyId, target: ctx.target, token, exceptVersionId: version.id, waitDeleted: true });
  }
  const ids = await uploadVersionToBackend({
    target: ctx.target,
    token,
    version,
    label: jobLabel(job, source),
    splitByH1: job.contentKind === "DOC",
    onStep: (step) => setStep(job.id, `第 ${n} 輪：${step}`),
  });

  await setStep(job.id, `第 ${n} 輪：後台學習中`);
  const items = new Map((await listKnowledge(ctx.target, token, AIBPO_KNOWLEDGE_PREFIX)).map((i) => [i.id, i]));
  if (ids.some((id) => !items.get(id) || items.get(id)!.status === DELETING_STATUS)) {
    // 後台的知識被人刪掉了：清掉紀錄，下一圈重新上傳
    await prisma.kbVersion.update({ where: { id: version.id }, data: { backendKnowledgeIds: Prisma.DbNull } });
    throw new Error("後台找不到這一輪上傳的知識（可能被手動刪除），請重試。");
  }
  const notLearned = ids.filter((id) => !isLearned(items.get(id)!));
  // 從呼叫學習 API 那一刻開始計時（中斷後繼續、已經學完的，從現在重新計時）
  let learnCalledAt = Date.now();
  if (notLearned.length > 0) {
    learnCalledAt = Date.now();
    try {
      await learnKnowledge(ctx.target, token, notLearned);
    } catch (err) {
      // 新增後後台可能已經自動開始學習，這時再送學習會失敗；改成直接等學習完成
      if (!(err instanceof KnowledgeApiError)) throw err;
    }
    await waitUntilAllLearned(ctx.target, token, ids, {
      shouldStop: () => isStopRequested(job.id),
      onProgress: (done, total) =>
        void setStep(job.id, `第 ${n} 輪：後台學習中${total > 1 ? `（完成 ${done}／${total} 份）` : ""}`).catch(() => {}),
    });
  }

  // 後台顯示「已學習」不代表機器人已經能用新知識回答：呼叫學習 API 後至少等滿使用者設定的分鐘數才開始問
  const until = learnCalledAt + job.learnWaitMinutes * 60_000;
  while (Date.now() < until) {
    const left = Math.ceil((until - Date.now()) / 60_000);
    await setStep(job.id, `第 ${n} 輪：後台已學習完成，呼叫學習後要等滿 ${job.learnWaitMinutes} 分鐘才開始問（剩約 ${left} 分鐘）`);
    if (await isStopRequested(job.id)) return; // 迴圈下一圈會把任務標成已停止
    await new Promise((r) => setTimeout(r, Math.min(15_000, until - Date.now())));
  }

  // 先試問第一題：機器人有回答才開始正式測試；完全沒回（逾時、出錯）就再等同樣的分鐘數再試，直到有回答或使用者按停止。
  // 回「尚未學習到相關知識」這類句子也算有回答，否則遇到本來就答不出來的題目會永遠等下去。
  const probe = await prisma.optimizationQuestion.findFirst({ where: { jobId: job.id }, orderBy: { order: "asc" } });
  if (probe) {
    const retryMs = Math.max(1, job.learnWaitMinutes) * 60_000;
    for (let attempt = 1; ; attempt++) {
      await setStep(job.id, `第 ${n} 輪：試問第一題，確認機器人已經能回答${attempt > 1 ? `（第 ${attempt} 次）` : ""}`);
      const result = await askBot(ctx.target, token, probe.question);
      if (result.status === "ANSWERED") break;
      const next = Date.now() + retryMs;
      while (Date.now() < next) {
        const left = Math.ceil((next - Date.now()) / 60_000);
        await setStep(job.id, `第 ${n} 輪：試問第一題機器人沒有回答，約 ${left} 分鐘後再試（已試 ${attempt} 次）`);
        if (await isStopRequested(job.id)) return;
        await new Promise((r) => setTimeout(r, Math.min(15_000, next - Date.now())));
      }
    }
  }

  await prisma.optimizationJob.update({ where: { id: job.id }, data: { resumeStep: "TEST" } });
}

// ---------------- 問機器人、算分、決定要不要繼續 ----------------

async function stepTest(job: OptimizationJob, ctx: JobContext, token: string) {
  const n = job.currentRun;
  const version = await currentVersion(job);

  // 中斷後繼續：沿用這一輪還沒做完的測試，只重問還沒成功的題目
  let run = await prisma.versionTestRun.findFirst({ where: { versionId: version.id }, orderBy: { createdAt: "desc" } });
  if (!run || run.status === "DONE") {
    const questions = await prisma.optimizationQuestion.findMany({ where: { jobId: job.id }, orderBy: { order: "asc" } });
    run = await prisma.versionTestRun.create({
      data: {
        versionId: version.id,
        roleId: job.roleId,
        createdById: job.createdById,
        total: questions.length,
        results: {
          create: questions.map((q) => ({
            jobQuestionId: q.id,
            order: q.order,
            question: q.question,
            expectedAnswer: q.expectedAnswer,
            customerId: "",
          })),
        },
      },
    });
  } else {
    await prisma.versionTestResult.updateMany({
      where: { runId: run.id, status: { in: ["PENDING", "ERROR"] } },
      data: { status: "PENDING", errorMessage: null, botAnswer: null, judgeVerdict: null, judgeReason: null, judgeDetail: Prisma.DbNull },
    });
    const done = await prisma.versionTestResult.count({ where: { runId: run.id, status: { not: "PENDING" } } });
    await prisma.versionTestRun.update({ where: { id: run.id }, data: { status: "RUNNING", errorMessage: null, completed: done } });
  }
  const runId = run.id;
  const pending = await prisma.versionTestResult.findMany({ where: { runId, status: "PENDING" }, orderBy: { order: "asc" } });

  await setStep(job.id, `第 ${n} 輪：問機器人＋AI 比對（共 ${run.total} 題）`);
  const { tokenError, skipped } = await runBotJobs({
    jobs: pending.map((r) => ({ id: r.id, question: r.question, expectedAnswer: r.expectedAnswer })),
    target: ctx.target,
    token,
    roleId: job.roleId,
    config: ctx.config,
    saveResult: async (resultId, data, meta) => {
      await prisma.versionTestResult.update({ where: { id: resultId }, data });
      if (meta.completed) await prisma.versionTestRun.update({ where: { id: runId }, data: { completed: { increment: 1 } } });
    },
    shouldStop: () => isStopRequested(job.id),
    judgeModel: job.judgeModel,
  });

  if (tokenError || skipped.length > 0) {
    if (skipped.length > 0 && tokenError) {
      await prisma.versionTestResult.updateMany({ where: { id: { in: skipped } }, data: { status: "ERROR", errorMessage: TOKEN_SKIPPED_MESSAGE } });
    }
    await prisma.versionTestRun.update({ where: { id: runId }, data: { status: "FAILED", errorMessage: tokenError ?? "已停止" } });
    if (tokenError) throw new BotTokenError(tokenError);
    return; // 使用者按了停止：迴圈下一圈會把任務標成已停止
  }
  await prisma.versionTestRun.update({ where: { id: runId }, data: { status: "DONE" } });

  // 計分：全部題目一起算；原題、相似題另外算，看機器人是不是只會背原題
  const results = await prisma.versionTestResult.findMany({ where: { runId }, include: { jobQuestion: { select: { isSimilar: true } } } });
  const pct = (list: typeof results) =>
    list.length === 0 ? null : Math.round((list.filter((r) => r.judgeVerdict === "MATCH").length / list.length) * 100);
  const scoreAll = pct(results) ?? 0;
  const scoreOriginal = pct(results.filter((r) => !r.jobQuestion?.isSimilar));
  const scoreSimilar = pct(results.filter((r) => r.jobQuestion?.isSimilar));
  // 平均涵蓋率：每題講到的關鍵答案比例（沒回答、比對失敗算 0），看部分一致的題目有沒有在進步
  const scoreCoverage =
    results.length === 0
      ? null
      : Math.round(results.reduce((sum, r) => sum + ((r.judgeDetail as { coverage?: number } | null)?.coverage ?? 0), 0) / results.length);
  await prisma.kbVersion.update({ where: { id: version.id }, data: { scoreAll, scoreOriginal, scoreSimilar, scoreCoverage } });

  const scored = await prisma.kbVersion.findMany({
    where: { jobId: job.id, scoreAll: { not: null } },
    select: { runIndex: true, scoreAll: true },
    orderBy: { runIndex: "asc" },
  });
  // 從某個版本繼續時，起點版本的分數當第 0 輪一起比（沒超過它就算沒進步）
  const baseline = job.baseVersionId
    ? await prisma.kbVersion.findUnique({ where: { id: job.baseVersionId }, select: { scoreAll: true } })
    : null;
  const candidates = [...(baseline?.scoreAll != null && job.currentRun > 0 ? [{ runIndex: 0, scoreAll: baseline.scoreAll }] : []), ...scored];
  const best = candidates.reduce((a, b) => ((b.scoreAll ?? 0) > (a.scoreAll ?? 0) ? b : a), candidates[0]);
  const bestText = best.runIndex === 0 ? `最佳仍是起點版本 ${best.scoreAll}%` : `最佳為第 ${best.runIndex} 輪 ${best.scoreAll}%`;

  let stopReason: string | null = null;
  if (scoreAll >= job.targetScore) stopReason = `達到目標正確率 ${job.targetScore}%`;
  else if (n >= job.maxRuns) stopReason = `已跑滿 ${job.maxRuns} 輪`;
  else if (n - (best.runIndex ?? n) >= job.stallRuns) stopReason = `連續 ${job.stallRuns} 輪沒有進步`;

  if (stopReason) {
    await prisma.optimizationJob.update({
      where: { id: job.id },
      data: { status: "DONE", stopReason, currentStep: `完成：${stopReason}，${bestText}` },
    });
    return;
  }
  await prisma.optimizationJob.update({
    where: { id: job.id },
    data: { resumeStep: "REVISE", currentStep: `第 ${n} 輪 ${scoreAll}%，AI 修改 md 中` },
  });
}

// ---------------- AI 依答錯清單修改整份 md ----------------

// 把範圍內所有來源的原始文件（PDF＋網址）當成同一份參考資料附上
function buildSourcesContent(sources: KmSource[]): { blocks: Anthropic.ContentBlockParam[]; urls: string[] } {
  const blocks: Anthropic.ContentBlockParam[] = sources.flatMap((s) =>
    getSourceFiles(s).map((f) => ({ type: "document" as const, source: { type: "file" as const, file_id: f.fileId }, title: f.fileName })),
  );
  const urls = [...new Set(sources.flatMap((s) => getSourceUrls(s)))];
  return { blocks, urls };
}

function stripCodeFence(text: string): string {
  const m = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return (m ? m[1] : text).trim();
}

// 修改的起點：這個任務裡分數最好的版本（從某版繼續時也比較起點版本）；退步的版本不在上面疊加修改
async function pickBaseVersion(job: OptimizationJob) {
  const ids = [
    ...(await prisma.kbVersion.findMany({ where: { jobId: job.id, scoreAll: { not: null } }, select: { id: true } })).map((v) => v.id),
    ...(job.baseVersionId ? [job.baseVersionId] : []),
  ];
  const candidates = await prisma.kbVersion.findMany({ where: { id: { in: ids }, scoreAll: { not: null } } });
  if (candidates.length === 0) {
    // 起點版本還沒分數（理論上不會發生）：退回目前這一輪
    return job.currentRun === 0 && job.baseVersionId ? prisma.kbVersion.findUnique({ where: { id: job.baseVersionId } }) : currentVersion(job);
  }
  // 分數相同時選涵蓋率高的，再相同選比較新的
  return candidates.sort(
    (a, b) =>
      (b.scoreAll ?? 0) - (a.scoreAll ?? 0) ||
      (b.scoreCoverage ?? 0) - (a.scoreCoverage ?? 0) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
}

// 這個任務先前診斷為「原文就沒有」的題目：之後不再拿來修改
async function notInSourceQuestions(jobId: string): Promise<Set<string>> {
  const versions = await prisma.kbVersion.findMany({ where: { jobId }, select: { revisionLog: true } });
  const set = new Set<string>();
  for (const v of versions) {
    const log = v.revisionLog as RevisionLog | null;
    for (const d of log?.diagnoses ?? []) if (d.cause === "NOT_IN_SOURCE") set.add(d.question.trim());
  }
  return set;
}

async function stepRevise(job: OptimizationJob, ctx: JobContext) {
  const n = job.currentRun;
  const base = await pickBaseVersion(job);
  if (!base) throw new Error("找不到要修改的版本。");
  const run = await prisma.versionTestRun.findFirst({
    where: { versionId: base.id, status: "DONE" },
    orderBy: { createdAt: "desc" },
    include: { results: { orderBy: { order: "asc" }, include: { jobQuestion: { select: { isSimilar: true } } } } },
  });
  if (!run) throw new Error(`找不到 ${base.name} 的測試結果。`);

  // 只把原題的不通過結果給 AI；相似題只當驗收（看換個問法是不是也會），避免 AI 照題目背答案
  const skipped = await notInSourceQuestions(job.id);
  const failing = run.results.filter((r) => r.judgeVerdict !== "MATCH" && !r.jobQuestion?.isSimilar && !skipped.has(r.question.trim()));
  if (failing.length === 0) {
    await finishJob(job.id, "原題都已通過（或只剩原文沒有的題目）；相似題只當驗收、不給 AI 修改");
    return;
  }
  const failures: EditFailure[] = failing.map((r) => {
    const detail = r.judgeDetail as JudgeDetail | null;
    return {
      question: r.question,
      expectedAnswer: r.expectedAnswer,
      botAnswer: r.botAnswer,
      verdict: r.judgeVerdict,
      missing: (detail?.points ?? []).filter((p) => p.status === "MISSING").map((p) => `${p.required ? "【必要】" : "【次要】"}${p.text}`),
      wrong: (detail?.points ?? []).filter((p) => p.status === "WRONG").map((p) => `${p.text}（機器人說：${p.evidence}）`),
      conflicts: detail?.conflicts ?? [],
      reason: r.judgeReason ?? r.errorMessage,
    };
  });

  const entries = await prisma.kmEntry.findMany({ where: { id: { in: asIds(job.entryIds) } }, select: { sourceId: true } });
  const sources = await prisma.kmSource.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.sourceId))] } } });
  const { blocks, urls } = buildSourcesContent(sources);
  const urlText = urls.length > 0 ? `原始文件還包含以下網址，請抓取內容一起參考：\n${urls.map((u) => `- ${u}`).join("\n")}\n\n` : "";
  const splitByH1 = job.contentKind === "DOC";

  await setStep(job.id, `第 ${n} 輪：AI 診斷 ${failures.length} 題答錯的原因並修改 md（從 ${base.name} 改）`);
  // 支援自適應思考的模型用 adaptive；不支援的（例如 Haiku）給固定思考預算
  const reviseModel = findAiModel(job.reviseModel);
  const response = await anthropic.messages
    .stream({
      model: reviseModel.id,
      max_tokens: 32000,
      thinking: reviseModel.adaptiveThinking ? { type: "adaptive" } : { type: "enabled", budget_tokens: 8000 },
      system: buildEditSystemPrompt({ guidelines: ctx.guidelines, config: ctx.config }),
      output_config: { format: { type: "json_schema", schema: EDIT_SCHEMA } },
      ...(urls.length > 0
        ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: Math.max(3, urls.length + 1) }] }
        : {}),
      messages: [
        {
          role: "user",
          content: [...blocks, { type: "text" as const, text: urlText + buildEditUserText({ markdown: base.markdown, failures, splitByH1 }) }],
        },
      ],
    })
    .finalMessage();
  await recordApiUsage({ model: reviseModel.id, purpose: "km_optimize_revise", usage: response.usage, roleId: job.roleId });
  if (response.stop_reason === "max_tokens") throw new Error("AI 的修改清單太長，輸出被截斷，這一輪沒有保存。");

  const parsed = JSON.parse(
    response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(""),
  ) as { diagnoses: { index: number; cause: EditCause; note: string }[]; edits: MdEdit[] };
  const diagnoses = parsed.diagnoses
    .filter((d) => d.index >= 1 && d.index <= failures.length)
    .map((d) => ({ question: failures[d.index - 1].question, cause: d.cause, note: d.note }));
  const questionOf = (i: number) => failures[i - 1]?.question ?? `第 ${i} 題`;

  // 沒有任何可以修的：剩下的都是原文沒有、或機器人本身的問題
  if (parsed.edits.length === 0) {
    const counts = Object.entries(
      diagnoses.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.cause]: (acc[d.cause] ?? 0) + 1 }), {}),
    )
      .map(([cause, count]) => `${EDIT_CAUSE_LABELS[cause as EditCause] ?? cause} ${count} 題`)
      .join("、");
    await finishJob(job.id, `剩下答錯的題目 md 改不了（${counts || "AI 沒有提出修改"}）`);
    return;
  }

  const editResult = applyMdEdits(base.markdown, parsed.edits);
  const edits = editResult.edits;
  let markdown = editResult.markdown;
  let mode: RevisionLog["mode"] = "edits";
  // 修改清單一項都對不上 md（定位失敗）：退回整份重寫
  if (!edits.some((e) => e.applied)) {
    await setStep(job.id, `第 ${n} 輪：局部修改都定位不到，改成 AI 整份重寫`);
    markdown = await rewriteWholeMarkdown(job, ctx, base.markdown, failures, run.results.length - failures.length, blocks, urlText);
    mode = "rewrite";
  }
  const growthPct = base.markdown.length > 0 ? Math.round(((markdown.length - base.markdown.length) / base.markdown.length) * 100) : 0;
  const applied = edits.filter((e) => e.applied).length;
  const revisionLog: RevisionLog = {
    mode,
    baseVersionId: base.id,
    baseVersionName: base.name,
    diagnoses,
    edits: edits.map((e) => ({ action: e.action, anchor: e.anchor, text: e.text, reason: e.reason, questions: e.questions.map(questionOf), applied: e.applied })),
    growthPct,
  };

  const source = job.sourceId ? await prisma.kmSource.findUnique({ where: { id: job.sourceId } }) : null;
  const settings = await versionSettings(job, ctx, n + 1);
  const note =
    mode === "edits"
      ? `從 ${base.name} 修改：診斷 ${failures.length} 題，套用 ${applied} 項修改${edits.length > applied ? `（${edits.length - applied} 項定位不到）` : ""}，md ${growthPct >= 0 ? "+" : ""}${growthPct}%`
      : `從 ${base.name} 整份重寫（局部修改定位不到），md ${growthPct >= 0 ? "+" : ""}${growthPct}%`;
  await prisma.$transaction([
    prisma.kbVersion.deleteMany({ where: { jobId: job.id, runIndex: n + 1 } }),
    prisma.kbVersion.create({
      data: {
        roleId: job.roleId,
        name: versionName(job, jobLabel(job, source), n + 1),
        note,
        createdById: job.createdById,
        markdown,
        entries: base.entries ?? [],
        entryCount: base.entryCount,
        settings,
        revisionLog,
        jobId: job.id,
        runIndex: n + 1,
      },
    }),
    prisma.optimizationJob.update({ where: { id: job.id }, data: { currentRun: n + 1, resumeStep: "UPLOAD" } }),
  ]);
}

async function finishJob(jobId: string, stopReason: string) {
  await prisma.optimizationJob.update({ where: { id: jobId }, data: { status: "DONE", stopReason, currentStep: `完成：${stopReason}` } });
}

// 退回方案：AI 依答錯清單整份重寫（舊做法），只在局部修改都定位不到時使用
async function rewriteWholeMarkdown(
  job: OptimizationJob,
  ctx: JobContext,
  baseMarkdown: string,
  failures: EditFailure[],
  passedCount: number,
  blocks: Anthropic.ContentBlockParam[],
  urlText: string,
): Promise<string> {
  const reviseModel = findAiModel(job.reviseModel);
  const response = await anthropic.messages
    .stream({
      model: reviseModel.id,
      max_tokens: 64000,
      thinking: reviseModel.adaptiveThinking ? { type: "adaptive" } : { type: "enabled", budget_tokens: 8000 },
      system: buildRevisionSystemPrompt({ guidelines: ctx.guidelines, config: ctx.config }),
      ...(urlText ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: 5 }] } : {}),
      messages: [
        {
          role: "user",
          content: [
            ...blocks,
            {
              type: "text" as const,
              text:
                urlText +
                buildRevisionUserText({
                  markdown: baseMarkdown,
                  failures: failures.map((f) => ({
                    question: f.question,
                    expectedAnswer: f.expectedAnswer,
                    botAnswer: f.botAnswer,
                    reason: [...f.missing.map((m) => `沒講到 ${m}`), ...f.wrong.map((w) => `講錯 ${w}`), ...f.conflicts].join("；") || f.reason,
                  })),
                  passedCount,
                  splitByH1: job.contentKind === "DOC",
                }),
            },
          ],
        },
      ],
    })
    .finalMessage();
  await recordApiUsage({ model: reviseModel.id, purpose: "km_optimize_revise", usage: response.usage, roleId: job.roleId });
  if (response.stop_reason === "max_tokens") throw new Error("修改後的 md 太長，輸出被截斷，這一輪沒有保存。");
  const markdown = stripCodeFence(
    response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n"),
  );
  if (!markdown) throw new Error("AI 沒有輸出修改後的 md。");
  return markdown;
}
