import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { KnowledgeList } from "./KnowledgeList";

function tallyLabel(t: { name: string; parent?: { name: string; parent?: { name: string } | null } | null }): string {
  const chain = [t.parent?.parent?.name, t.parent?.name, t.name].filter(Boolean);
  return chain.join(" › ");
}

export default async function KnowledgePage() {
  const session = await requireSession();

  const [entries, tallies] = await Promise.all([
    prisma.kmEntry.findMany({
      where: { confirmed: true, ...roleScope(session) },
      include: { source: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tally.findMany({
      where: roleScope(session),
      include: { parent: { include: { parent: true } } },
      orderBy: { order: "asc" },
    }),
  ]);

  const tallyOptions = tallies.map((t) => ({ id: t.id, label: tallyLabel(t) }));
  const listEntries = entries.map((e) => ({
    id: e.id,
    question: e.question,
    answer: e.answer,
    tallyId: e.tallyId,
    sourceTitle: e.source.title,
  }));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">知識列表</h1>
        <p className="mt-1 text-sm text-slate-500">
          在「新增KM」勾選確認過的 FAQ 都會出現在這裡，可以依分類篩選，勾選後匯出成 .md。
        </p>
      </div>

      <KnowledgeList entries={listEntries} tallyOptions={tallyOptions} />
    </div>
  );
}
