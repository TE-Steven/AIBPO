import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { Prisma, type KmSource, type OptimizationJob } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { companyIdForRole } from "@/lib/company";
import { BotTokenError, getBotTestTarget, tokenExpiresAt, type BotTestTarget } from "@/lib/botTest";
import { runBotJobs, TOKEN_SKIPPED_MESSAGE } from "@/lib/botTestRunner";
import { getPromptConfig } from "@/lib/promptConfigStore";
import { resolveOptions, type PromptConfigData } from "@/lib/promptConfig";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { buildKnowledgeMarkdown, tallyPathOf, type ExportEntry } from "@/lib/kmExport";
import { buildTallyDocumentsMarkdown } from "@/lib/tallyDocumentsExport";
import { getSourceFiles, getSourceUrls } from "@/lib/kmAnalysis";
import { tallyPathOptions } from "@/lib/tallyTree";
import {
  buildRevisionSystemPrompt,
  buildRevisionUserText,
  buildSimilarQuestionsSystemPrompt,
  SIMILAR_QUESTIONS_SCHEMA,
} from "@/lib/optimizationPrompts";
import {
  createKnowledge,
  deleteKnowledge,
  findKnowledgeByName,
  isLearned,
  KnowledgeApiError,
  learnKnowledge,
  listKnowledge,
  uploadMarkdown,
  waitUntilLearned,
} from "@/lib/telligentKb";

// 自動優化的背景迴圈：每一輪 上傳 md → 後台學習 → 全部題目問機器人＋AI 比對 → 算分 → 沒達標就請 Claude 依答錯清單改整份 md。
// 每一步做完都寫回 DB（resumeStep），所以暫停（token 過期、伺服器重啟）後貼新 token 可以從中斷的那一步繼續。
// token 只放在這個行程的記憶體裡，不進 DB；伺服器重啟時 instrumentation 會把 RUNNING 的任務標成 PAUSED_TOKEN。

// 跟 Prisma client 一樣掛在 globalThis：開發模式熱更新後，server action 跟背景迴圈仍然看得到同一份
type RunnerState = { tokens: Map<string, string>; running: Set<string> };
const globalForRunner = globalThis as unknown as { aibpoOptimization?: RunnerState };
const state: RunnerState = (globalForRunner.aibpoOptimization ??= { tokens: new Map(), running: new Set() });

// token 剩不到這麼久就先暫停，避免做到一半才失效
const TOKEN_MIN_REMAINING_MS = 3 * 60_000;
// 後台學習完成後，等一下再開始問，讓新知識生效
const AFTER_LEARN_DELAY_MS = 30_000;

export const ACTIVE_JOB_STATUSES = ["RUNNING", "PAUSED_TOKEN"];

export function isJobLoopRunning(jobId: string): boolean {
  return state.running.has(jobId);
}

// 啟動（或繼續）一個任務的背景迴圈；已經在跑就只更新 token
export function launchOptimizationJob(jobId: string, token: string): void {
  state.tokens.set(jobId, token);
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

async function runLoop(jobId: string): Promise<void> {
  for (;;) {
    const job = await prisma.optimizationJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING") return;
    if (job.stopRequested) {
      await prisma.optimizationJob.update({ where: { id: jobId }, data: { status: "STOPPED", stopReason: "使用者停止", currentStep: "已停止" } });
      return;
    }
    const token = state.tokens.get(jobId);
    if (!token) {
      await pause(jobId, "token 不在伺服器記憶體裡（可能伺服器重新啟動），請貼新的 token 繼續。");
      return;
    }
    const exp = tokenExpiresAt(token);
    if (exp && exp - Date.now() < TOKEN_MIN_REMAINING_MS) {
      await pause(jobId, "token 快過期了，請貼新的 token 繼續。");
      return;
    }

    try {
      const ctx = await loadContext(job);
      if (job.resumeStep === "PREPARE") await stepPrepare(job, ctx);
      else if (job.resumeStep === "UPLOAD") await stepUpload(job, ctx, token);
      else if (job.resumeStep === "TEST") await stepTest(job, ctx, token);
      else if (job.resumeStep === "REVISE") await stepRevise(job, ctx);
      else throw new Error(`不認得的步驟 ${job.resumeStep}`);
    } catch (err) {
      if (err instanceof BotTokenError) {
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
    similar = await generateSimilarQuestions(originals, job.similarCount, ctx.config, job.roleId);
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
        name: `${label} 自動優化 r1`,
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

async function generateSimilarQuestions(
  originals: { question: string; expectedAnswer: string }[],
  count: number,
  config: PromptConfigData,
  roleId: string,
): Promise<string[][]> {
  const list = originals
    .map((q, i) => `<item index="${i + 1}">\n<question>${q.question}</question>\n<answer>${q.expectedAnswer}</answer>\n</item>`)
    .join("\n");
  const response = await anthropic.messages
    .stream({
      model: KM_ANALYSIS_MODEL,
      max_tokens: 32000,
      system: buildSimilarQuestionsSystemPrompt({ count, config }),
      output_config: { effort: "low", format: { type: "json_schema", schema: SIMILAR_QUESTIONS_SCHEMA } },
      messages: [{ role: "user", content: `${list}\n\n請為以上每一題各寫 ${count} 個相似問法，index 對應題號。` }],
    })
    .finalMessage();
  await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "km_optimize_similar", usage: response.usage, roleId });
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
  let deleted = 0;
  for (const v of stale) {
    const ids = asIds(v.backendKnowledgeIds);
    if (ids.length > 0) await deleteKnowledge(params.target, params.token, ids);
    await prisma.kbVersion.update({ where: { id: v.id }, data: { backendKnowledgeIds: Prisma.DbNull } });
    deleted += ids.length;
  }
  return deleted;
}

export function backendKnowledgeName(label: string, versionId: string, runIndex: number | null): string {
  const safe = label.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  return `AIBPO-${safe}-${versionId.slice(-6)}${runIndex ? `-r${runIndex}` : ""}`;
}

// 上傳一個版本的 md 到後台並新增知識，記下 id（之後只刪這一批）。已上傳過（例如中斷後繼續）就沿用。
export async function uploadVersionToBackend(params: {
  target: BotTestTarget;
  token: string;
  version: { id: string; markdown: string; backendKnowledgeIds: Prisma.JsonValue | null; runIndex: number | null };
  label: string;
  onStep?: (step: string) => Promise<void>;
}): Promise<string[]> {
  const existingIds = asIds(params.version.backendKnowledgeIds);
  if (existingIds.length > 0) return existingIds;

  const name = backendKnowledgeName(params.label, params.version.id, params.version.runIndex);
  // 上次新增成功但還沒來得及記下 id 就中斷：用唯一名稱找回來，避免重複上傳
  let id = (await findKnowledgeByName(params.target, params.token, name))?.id;
  if (!id) {
    await params.onStep?.("上傳 md 到後台");
    const url = await uploadMarkdown(params.target, params.token, params.version.markdown, `${name}.md`);
    await params.onStep?.("新增後台知識");
    id = await createKnowledge(params.target, params.token, { name, url, sourceName: `${name}.md` });
  }
  await prisma.kbVersion.update({ where: { id: params.version.id }, data: { backendKnowledgeIds: [id] } });
  return [id];
}

async function stepUpload(job: OptimizationJob, ctx: JobContext, token: string) {
  const n = job.currentRun;
  const version = await currentVersion(job);
  const source = job.sourceId ? await prisma.kmSource.findUnique({ where: { id: job.sourceId } }) : null;

  if (asIds(version.backendKnowledgeIds).length === 0) {
    await setStep(job.id, `第 ${n} 輪：刪除後台上一版`);
    await clearRecordedBackendKnowledge({ companyId: ctx.companyId, target: ctx.target, token, exceptVersionId: version.id });
  }
  const ids = await uploadVersionToBackend({
    target: ctx.target,
    token,
    version,
    label: jobLabel(job, source),
    onStep: (step) => setStep(job.id, `第 ${n} 輪：${step}`),
  });

  await setStep(job.id, `第 ${n} 輪：後台學習中`);
  const item = (await listKnowledge(ctx.target, token)).find((i) => i.id === ids[0]);
  if (!item) {
    // 後台的知識被人刪掉了：清掉紀錄，下一圈重新上傳
    await prisma.kbVersion.update({ where: { id: version.id }, data: { backendKnowledgeIds: Prisma.DbNull } });
    throw new Error("後台找不到這一輪上傳的知識（可能被手動刪除），請重試。");
  }
  if (!isLearned(item)) {
    try {
      await learnKnowledge(ctx.target, token, ids);
    } catch (err) {
      // 新增後後台可能已經自動開始學習，這時再送學習會失敗；改成直接等學習完成
      if (!(err instanceof KnowledgeApiError)) throw err;
    }
    await waitUntilLearned(ctx.target, token, ids[0], {
      shouldStop: () => isStopRequested(job.id),
      onStatus: (status) => void setStep(job.id, `第 ${n} 輪：後台學習中（狀態 ${status}）`).catch(() => {}),
    });
    await setStep(job.id, `第 ${n} 輪：學習完成，稍等一下讓知識生效`);
    await new Promise((r) => setTimeout(r, AFTER_LEARN_DELAY_MS));
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
      data: { status: "PENDING", errorMessage: null, botAnswer: null, judgeVerdict: null, judgeReason: null },
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
  await prisma.kbVersion.update({ where: { id: version.id }, data: { scoreAll, scoreOriginal, scoreSimilar } });

  const scored = await prisma.kbVersion.findMany({
    where: { jobId: job.id, scoreAll: { not: null } },
    select: { runIndex: true, scoreAll: true },
    orderBy: { runIndex: "asc" },
  });
  const best = scored.reduce((a, b) => ((b.scoreAll ?? 0) > (a.scoreAll ?? 0) ? b : a), scored[0]);
  const bestText = `最佳為第 ${best.runIndex} 輪 ${best.scoreAll}%`;

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

async function stepRevise(job: OptimizationJob, ctx: JobContext) {
  const n = job.currentRun;
  const version = await currentVersion(job);
  const run = await prisma.versionTestRun.findFirst({
    where: { versionId: version.id, status: "DONE" },
    orderBy: { createdAt: "desc" },
    include: { results: { orderBy: { order: "asc" } } },
  });
  if (!run) throw new Error(`找不到第 ${n} 輪的測試結果。`);

  const failures = run.results
    .filter((r) => r.judgeVerdict !== "MATCH")
    .map((r) => ({ question: r.question, expectedAnswer: r.expectedAnswer, botAnswer: r.botAnswer, reason: r.judgeReason ?? r.errorMessage }));
  const passedCount = run.results.length - failures.length;

  const entries = await prisma.kmEntry.findMany({ where: { id: { in: asIds(job.entryIds) } }, select: { sourceId: true } });
  const sources = await prisma.kmSource.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.sourceId))] } } });
  const { blocks, urls } = buildSourcesContent(sources);
  const urlText = urls.length > 0 ? `原始文件還包含以下網址，請抓取內容一起參考：\n${urls.map((u) => `- ${u}`).join("\n")}\n\n` : "";

  await setStep(job.id, `第 ${n} 輪：AI 依 ${failures.length} 題答錯修改 md`);
  const response = await anthropic.messages
    .stream({
      model: KM_ANALYSIS_MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: buildRevisionSystemPrompt({ guidelines: ctx.guidelines, config: ctx.config }),
      ...(urls.length > 0
        ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: Math.max(3, urls.length + 1) }] }
        : {}),
      messages: [
        {
          role: "user",
          content: [...blocks, { type: "text" as const, text: urlText + buildRevisionUserText({ markdown: version.markdown, failures, passedCount }) }],
        },
      ],
    })
    .finalMessage();
  await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "km_optimize_revise", usage: response.usage, roleId: job.roleId });
  if (response.stop_reason === "max_tokens") throw new Error("修改後的 md 太長，輸出被截斷，這一輪沒有保存。");

  const markdown = stripCodeFence(
    response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n"),
  );
  if (!markdown) throw new Error("AI 沒有輸出修改後的 md。");

  const source = job.sourceId ? await prisma.kmSource.findUnique({ where: { id: job.sourceId } }) : null;
  const settings = await versionSettings(job, ctx, n + 1);
  await prisma.$transaction([
    prisma.kbVersion.deleteMany({ where: { jobId: job.id, runIndex: n + 1 } }),
    prisma.kbVersion.create({
      data: {
        roleId: job.roleId,
        name: `${jobLabel(job, source)} 自動優化 r${n + 1}`,
        note: `自動優化第 ${n + 1} 輪：AI 依第 ${n} 輪答錯的 ${failures.length} 題修改`,
        createdById: job.createdById,
        markdown,
        entries: version.entries ?? [],
        entryCount: version.entryCount,
        settings,
        jobId: job.id,
        runIndex: n + 1,
      },
    }),
    prisma.optimizationJob.update({ where: { id: job.id }, data: { currentRun: n + 1, resumeStep: "UPLOAD" } }),
  ]);
}
