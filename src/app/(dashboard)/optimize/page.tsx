import { requireCompanyUser } from "@/lib/session";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getBotTestTarget } from "@/lib/botTest";
import { isJobLoopRunning, jobLabel } from "@/lib/optimizationRunner";
import { findAiModel } from "@/lib/aiModels";
import { OptimizeWorkspace, type JobView, type SourceOption } from "./OptimizeWorkspace";
import type { TokenAverage } from "./optimizeShared";

export const dynamic = "force-dynamic";

export default async function OptimizePage() {
  const session = await requireCompanyUser();

  const roleIds = (await prisma.role.findMany({ where: { companyId: session.companyId }, select: { id: true } })).map((r) => r.id);
  const [target, sources, entryCounts, testCaseCount, jobs, questionCounts, deployed] = await Promise.all([
    getBotTestTarget(session.companyId),
    prisma.kmSource.findMany({ where: { roleId: session.roleId }, select: { id: true, title: true }, orderBy: { createdAt: "desc" } }),
    prisma.kmEntry.groupBy({ by: ["sourceId", "kind", "confirmed"], where: { roleId: session.roleId }, _count: { _all: true } }),
    prisma.testCase.count({ where: { roleId: session.roleId, archived: false } }),
    prisma.optimizationJob.findMany({
      where: { roleId: session.roleId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        source: { select: { title: true } },
        versions: {
          orderBy: { runIndex: "asc" },
          select: {
            id: true,
            name: true,
            runIndex: true,
            scoreAll: true,
            scoreOriginal: true,
            scoreSimilar: true,
            backendKnowledgeIds: true,
            createdAt: true,
            entryCount: true,
            testRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, total: true, completed: true } },
            _count: { select: { testRuns: { where: { status: "DONE" } } } },
          },
        },
      },
    }),
    prisma.optimizationQuestion.groupBy({ by: ["jobId", "isSimilar"], where: { job: { roleId: session.roleId } }, _count: { _all: true } }),
    // 目前放在後台的 AIBPO 版本（整間公司共用同一個後台）
    prisma.kbVersion.findFirst({
      where: { roleId: { in: roleIds }, backendKnowledgeIds: { not: Prisma.DbNull } },
      select: { id: true, name: true },
    }),
  ]);
  // 「從某版繼續」的任務：起點版本的名稱
  const baseIds = jobs.flatMap((j) => (j.baseVersionId ? [j.baseVersionId] : []));
  const versionNames = new Map(
    (baseIds.length > 0 ? await prisma.kbVersion.findMany({ where: { id: { in: baseIds } }, select: { id: true, name: true } }) : []).map((v) => [
      v.id,
      v.name,
    ]),
  );

  // 這間公司最近實際的平均 token 數（每次呼叫）；畫面上依選的模型單價換算預估費用
  const avgTokens = async (purpose: string): Promise<TokenAverage | null> => {
    const logs = await prisma.apiUsageLog.findMany({
      where: { companyId: session.companyId, purpose },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { inputTokens: true, outputTokens: true, cacheCreationTokens: true, cacheReadTokens: true },
    });
    if (logs.length === 0) return null;
    return {
      // 快取讀取只算一成價錢，換算成等值的輸入 token
      input: logs.reduce((sum, l) => sum + l.inputTokens + l.cacheCreationTokens + l.cacheReadTokens * 0.1, 0) / logs.length,
      output: logs.reduce((sum, l) => sum + l.outputTokens, 0) / logs.length,
    };
  };
  const [judgeTokens, reviseTokens] = await Promise.all([avgTokens("bot_test_judge"), avgTokens("km_optimize_revise")]);


  const sourceOptions: SourceOption[] = sources.map((s) => {
    const count = (kind: string, confirmedOnly: boolean) =>
      entryCounts
        .filter((c) => c.sourceId === s.id && c.kind === kind && (!confirmedOnly || c.confirmed))
        .reduce((sum, c) => sum + c._count._all, 0);
    return {
      id: s.id,
      title: s.title,
      faq: count("FAQ", false),
      doc: count("DOC", false),
      confirmedFaq: count("FAQ", true),
      confirmedDoc: count("DOC", true),
    };
  });

  const jobViews: JobView[] = jobs.map((j) => ({
    id: j.id,
    label: jobLabel(j, j.source),
    seq: j.seq,
    judgeModel: j.judgeModel,
    learnWaitMinutes: j.learnWaitMinutes,
    reviseModel: j.reviseModel,
    models: `比對 ${findAiModel(j.judgeModel).label}・修改 ${findAiModel(j.reviseModel).label}${j.similarCount > 0 && !j.baseVersionId ? `・相似題 ${findAiModel(j.similarModel).label}` : ""}`,
    baseVersionName: j.baseVersionId ? (versionNames.get(j.baseVersionId) ?? "（版本已刪除）") : null,
    scope: j.scope,
    contentKind: j.contentKind,
    questionSource: j.questionSource,
    maxRuns: j.maxRuns,
    targetScore: j.targetScore,
    similarCount: j.similarCount,
    stallRuns: j.stallRuns,
    // 標著執行中、但這台伺服器沒有在跑它（例如本機開發重開過）：畫面上讓使用者可以貼 token 接手
    status: j.status === "RUNNING" && !isJobLoopRunning(j.id) ? "PAUSED_TOKEN" : j.status,
    currentRun: j.currentRun,
    currentStep: j.currentStep,
    stopReason: j.stopReason,
    errorMessage: j.errorMessage,
    createdAt: j.createdAt.toISOString(),
    originalCount: questionCounts.find((c) => c.jobId === j.id && !c.isSimilar)?._count._all ?? 0,
    similarTotal: questionCounts.find((c) => c.jobId === j.id && c.isSimilar)?._count._all ?? 0,
    runs: j.versions.map((v) => ({
      versionId: v.id,
      name: v.name,
      runIndex: v.runIndex ?? 0,
      scoreAll: v.scoreAll,
      scoreOriginal: v.scoreOriginal,
      scoreSimilar: v.scoreSimilar,
      inBackend: Array.isArray(v.backendKnowledgeIds) && v.backendKnowledgeIds.length > 0,
      testStatus: v.testRuns[0]?.status ?? null,
      testTotal: v.testRuns[0]?.total ?? 0,
      testCompleted: v.testRuns[0]?.completed ?? 0,
      tested: v._count.testRuns > 0,
      entryCount: v.entryCount,
    })),
  }));


  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">自動優化</h1>
        <p className="mt-1 text-sm text-slate-500">
          系統自動把 md 上傳到後台知識庫、學習後用題目測機器人，AI 依答錯的題目修改整份 md 再重測，每一輪都留下版本與正確率，最後挑一份最好的部署到後台。
        </p>
      </div>
      <OptimizeWorkspace
        targetReady={Boolean(target?.knowledgePlatformId)}
        canRefresh={Boolean(target?.clientId && target?.clientSecret && target?.tokenCompanyId && target?.tokenCompanyCode)}
        usageStats={{ judge: judgeTokens, revise: reviseTokens }}
        sources={sourceOptions}
        testCaseCount={testCaseCount}
        jobs={jobViews}
        deployedVersion={deployed}
      />
    </div>
  );
}
