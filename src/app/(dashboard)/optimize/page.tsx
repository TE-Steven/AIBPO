import { requireCompanyUser } from "@/lib/session";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getBotTestTarget } from "@/lib/botTest";
import { isJobLoopRunning, jobLabel } from "@/lib/optimizationRunner";
import { OptimizeWorkspace, type JobView, type SourceOption } from "./OptimizeWorkspace";
import type { OptVersionView } from "./VersionsTab";

export const dynamic = "force-dynamic";

export default async function OptimizePage() {
  const session = await requireCompanyUser();

  const roleIds = (await prisma.role.findMany({ where: { companyId: session.companyId }, select: { id: true } })).map((r) => r.id);
  const [target, sources, entryCounts, testCaseCount, jobs, questionCounts, deployed, versions] = await Promise.all([
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
            testRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, total: true, completed: true } },
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
    // 版本分頁：所有自動優化產生的版本
    prisma.kbVersion.findMany({
      where: { roleId: session.roleId, jobId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        name: true,
        runIndex: true,
        scoreAll: true,
        scoreOriginal: true,
        scoreSimilar: true,
        backendKnowledgeIds: true,
        createdAt: true,
        job: { select: { seq: true, contentKind: true, targetScore: true } },
        _count: { select: { testRuns: { where: { status: "DONE" } } } },
      },
    }),
  ]);
  const versionNames = new Map(versions.map((v) => [v.id, v.name]));

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
    })),
  }));

  const versionViews: OptVersionView[] = versions.map((v) => ({
    id: v.id,
    name: v.name,
    jobSeq: v.job?.seq ?? 0,
    runIndex: v.runIndex ?? 0,
    contentKind: v.job?.contentKind ?? "FAQ",
    targetScore: v.job?.targetScore ?? 90,
    scoreAll: v.scoreAll,
    scoreOriginal: v.scoreOriginal,
    scoreSimilar: v.scoreSimilar,
    inBackend: Array.isArray(v.backendKnowledgeIds) && v.backendKnowledgeIds.length > 0,
    tested: v._count.testRuns > 0,
    createdAt: v.createdAt.toISOString(),
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
        canRefresh={Boolean(target?.clientId && target?.clientSecret)}
        sources={sourceOptions}
        testCaseCount={testCaseCount}
        jobs={jobViews}
        versions={versionViews}
        deployedVersion={deployed}
      />
    </div>
  );
}
