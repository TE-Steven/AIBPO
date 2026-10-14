import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// 下載自動優化任務的診斷資料（JSON）：各版本分數、逐題結果、AI 修改紀錄與 md 全文，用來分析分數為什麼退步。
// 「從某版繼續」的任務會往前追起點版本所屬的任務（最多 5 層），才看得到完整的演變。不含任何 token。

const MAX_CHAIN = 5;

async function jobDump(jobId: string) {
  const job = await prisma.optimizationJob.findUnique({
    where: { id: jobId },
    include: {
      questions: { orderBy: { order: "asc" } },
      versions: {
        orderBy: [{ runIndex: "asc" }, { createdAt: "asc" }],
        include: {
          testRuns: {
            orderBy: { createdAt: "asc" },
            include: { results: { orderBy: { order: "asc" } } },
          },
        },
      },
    },
  });
  if (!job) return null;
  const isSimilar = new Map(job.questions.map((q) => [q.id, q.isSimilar]));
  return {
    job: {
      id: job.id,
      seq: job.seq,
      baseVersionId: job.baseVersionId,
      scope: job.scope,
      contentKind: job.contentKind,
      questionSource: job.questionSource,
      maxRuns: job.maxRuns,
      targetScore: job.targetScore,
      similarCount: job.similarCount,
      stallRuns: job.stallRuns,
      learnWaitMinutes: job.learnWaitMinutes,
      botName: job.botName,
      judgeModel: job.judgeModel,
      reviseModel: job.reviseModel,
      similarModel: job.similarModel,
      status: job.status,
      currentRun: job.currentRun,
      stopReason: job.stopReason,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
    },
    questions: job.questions.map((q) => ({
      id: q.id,
      order: q.order,
      isSimilar: q.isSimilar,
      parentId: q.parentId,
      question: q.question,
      expectedAnswer: q.expectedAnswer,
      userNote: q.userNote,
      userNoteUpdatedAt: q.userNoteUpdatedAt,
    })),
    versions: job.versions.map((v) => ({
      id: v.id,
      name: v.name,
      runIndex: v.runIndex,
      createdAt: v.createdAt,
      scoreAll: v.scoreAll,
      scoreOriginal: v.scoreOriginal,
      scoreSimilar: v.scoreSimilar,
      scoreCoverage: v.scoreCoverage,
      markdownChars: v.markdown.length,
      markdown: v.markdown,
      revisionLog: v.revisionLog,
      testRuns: v.testRuns.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        errorMessage: r.errorMessage,
        results: r.results.map((x) => ({
          order: x.order,
          jobQuestionId: x.jobQuestionId,
          isSimilar: x.jobQuestionId ? (isSimilar.get(x.jobQuestionId) ?? null) : null,
          question: x.question,
          expectedAnswer: x.expectedAnswer,
          status: x.status,
          botAnswer: x.botAnswer,
          judgeVerdict: x.judgeVerdict,
          judgeReason: x.judgeReason,
          judgeDetail: x.judgeDetail,
          errorMessage: x.errorMessage,
        })),
      })),
    })),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const first = await prisma.optimizationJob.findUnique({ where: { id }, select: { roleId: true } });
  if (!first) return new Response("Not found", { status: 404 });
  if (session.kind !== "superadmin" && first.roleId !== session.roleId) return new Response("Forbidden", { status: 403 });

  const chain = [];
  let jobId: string | null = id;
  const seen = new Set<string>();
  while (jobId && !seen.has(jobId) && chain.length < MAX_CHAIN) {
    seen.add(jobId);
    const dump = await jobDump(jobId);
    if (!dump) break;
    chain.push(dump);
    const baseId: string | null = dump.job.baseVersionId;
    const base: { jobId: string | null; roleId: string } | null = baseId
      ? await prisma.kbVersion.findUnique({ where: { id: baseId }, select: { jobId: true, roleId: true } })
      : null;
    jobId = base && base.roleId === first.roleId ? base.jobId : null;
  }

  const body = JSON.stringify({ exportedAt: new Date(), jobs: chain }, null, 1);
  const name = encodeURIComponent(`自動優化診斷-#${chain[0]?.job.seq ?? ""}.json`);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="optimization-diagnostics.json"; filename*=UTF-8''${name}`,
    },
  });
}
