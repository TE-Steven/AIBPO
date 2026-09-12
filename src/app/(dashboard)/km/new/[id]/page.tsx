import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AnalysisRunner } from "./AnalysisRunner";
import { ResultsEditor } from "./ResultsEditor";
import { ChatPanel } from "./ChatPanel";
import { EditableTitle } from "./EditableTitle";
import { IconArrowLeft, IconAlertTriangle } from "@/components/icons";

function tallyLabel(t: { name: string; parent?: { name: string; parent?: { name: string } | null } | null }): string {
  const chain = [t.parent?.parent?.name, t.parent?.name, t.name].filter(Boolean);
  return chain.join(" › ");
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

  const entries =
    source.status === "DONE"
      ? await prisma.kmEntry.findMany({ where: { sourceId: id }, orderBy: { createdAt: "asc" } })
      : [];

  const tallyOptions = tallies.map((t) => ({ id: t.id, label: tallyLabel(t) }));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Link href="/km/new" className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <IconArrowLeft className="h-4 w-4" />
          回到來源列表
        </Link>
        <EditableTitle sourceId={source.id} initialTitle={source.title} />
        <p className="mt-1 text-sm text-slate-500">
          {source.sourceType === "PDF" ? `PDF：${source.sourceName}` : `URL：${source.sourceUrl}`}
        </p>
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
        />
      )}

      {source.status === "DONE" && (
        <>
          <ChatPanel sourceId={source.id} />
          <ResultsEditor entries={entries} tallyOptions={tallyOptions} />
        </>
      )}
    </div>
  );
}
