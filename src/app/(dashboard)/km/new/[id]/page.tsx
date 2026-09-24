import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AnalysisRunner } from "./AnalysisRunner";
import { ResultsEditor } from "./ResultsEditor";
import { ChatPanel } from "./ChatPanel";
import { EditableTitle } from "./EditableTitle";
import { ExtraOutputsPanel } from "./ExtraOutputsPanel";
import { BotTestPanel } from "./BotTestPanel";
import { getBotTestTarget } from "@/lib/botTest";
import { companyIdForRole } from "@/lib/company";
import { buildTallyTree, tallyTemplates } from "@/lib/tallyTree";
import { sourceLabel } from "@/lib/kmAnalysis";
import { IconArrowLeft, IconAlertTriangle } from "@/components/icons";

function tallyLabel(t: { name: string; parent?: { name: string; parent?: { name: string } | null } | null }): string {
  const chain = [t.parent?.parent?.name, t.parent?.name, t.name].filter(Boolean);
  return chain.join(" › ");
}

// 「產生中」已經進行幾分鐘（舊資料沒有開始時間時為 null），讓使用者判斷是不是卡住了
function elapsedMinutes(startedAt: Date | null): number | null {
  return startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 60000) : null;
}

export default async function KmSourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) notFound();
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) notFound();

  const [dimensions, tallies] = await Promise.all([
    prisma.dimension.findMany({ where: roleScope(session), orderBy: { createdAt: "asc" } }),
    prisma.tally.findMany({
      where: roleScope(session),
      include: { parent: { include: { parent: true } } },
      orderBy: { order: "asc" },
    }),
  ]);

  const [entries, draftCount, botTestRuns, botTestTarget] = await Promise.all([
    source.status === "DONE"
      ? prisma.kmEntry.findMany({ where: { sourceId: id }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.agentDraft.count({ where: { sourceId: id, confirmed: false } }),
    prisma.botTestRun.findMany({
      where: { sourceId: id },
      include: { results: { include: { entry: true }, orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    companyIdForRole(source.roleId).then(getBotTestTarget),
  ]);

  const tallyOptions = tallies.map((t) => ({ id: t.id, label: tallyLabel(t) }));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Link href="/km/new" className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <IconArrowLeft className="h-4 w-4" />
          回到來源列表
        </Link>
        <EditableTitle sourceId={source.id} initialTitle={source.title} />
        <p className="mt-1 text-sm text-slate-500">{sourceLabel(source)}</p>
      </div>

      {source.status === "FAILED" && source.errorMessage && (
        <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-600 ring-1 ring-inset ring-rose-100">
          <IconAlertTriangle className="h-4 w-4 shrink-0" />
          上次分析失敗：{source.errorMessage}
        </p>
      )}

      {(source.status === "PENDING" || source.status === "FAILED") && (
        <AnalysisRunner
          sourceId={source.id}
          dimensions={dimensions.map((d) => ({ id: d.id, name: d.name }))}
          hasTallies={tallies.length > 0}
          templateNames={tallyTemplates(buildTallyTree(tallies)).map((t) => t.name)}
        />
      )}

      {source.status === "DONE" && (
        <>
          <ChatPanel sourceId={source.id} />
          <ExtraOutputsPanel
            sourceId={source.id}
            ragStatus={source.ragStatus}
            ragContent={source.ragContent}
            ragErrorMessage={source.ragErrorMessage}
            workflowStatus={source.workflowStatus}
            workflowErrorMessage={source.workflowErrorMessage}
            ragElapsedMinutes={elapsedMinutes(source.ragStartedAt)}
            workflowElapsedMinutes={elapsedMinutes(source.workflowStartedAt)}
            draftCount={draftCount}
          />
          <BotTestPanel
            sourceId={source.id}
            entryCount={entries.filter((e) => e.kind === "FAQ").length}
            targetLabel={botTestTarget ? `${botTestTarget.gatewayBaseUrl}（channel ${botTestTarget.platformId}）` : null}
            runs={botTestRuns.map((r) => ({
              id: r.id,
              status: r.status,
              total: r.total,
              completed: r.completed,
              errorMessage: r.errorMessage,
              createdAt: r.createdAt.toISOString(),
              // 這次測試之後才新增的題目：重新測試時可以勾選一起送出
              untested: entries
                .filter((e) => e.kind === "FAQ" && !r.results.some((x) => x.entryId === e.id))
                .map((e) => ({ entryId: e.id, question: e.question, expectedAnswer: e.answer })),
              results: r.results.map((x) => ({
                id: x.id,
                order: x.order,
                // 顯示題目列表上的最新內容；題目被刪掉時才用當時送出的快照
                question: x.entry?.question ?? x.question,
                expectedAnswer: x.entry?.answer ?? x.expectedAnswer,
                questionChanged: x.entry ? x.entry.question !== x.question : false,
                // 上次 AI 比對之後，標準答案又被編輯過
                answerChanged: Boolean(x.entry && x.judgeVerdict && x.entry.answer !== x.expectedAnswer),
                entryDeleted: !x.entry,
                judgeVerdict: x.judgeVerdict,
                judgeReason: x.judgeReason,
                botAnswer: x.botAnswer,
                status: x.status,
                errorMessage: x.errorMessage,
              })),
            }))}
          />
          <ResultsEditor entries={entries} tallyOptions={tallyOptions} />
        </>
      )}
    </div>
  );
}
