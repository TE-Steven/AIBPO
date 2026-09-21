import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { DraftCard } from "./DraftCard";

export default async function AgentDraftsPage() {
  const session = await requireSession();

  const [drafts, skills] = await Promise.all([
    prisma.agentDraft.findMany({
      where: { ...roleScope(session), confirmed: false },
      include: { source: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.skill.findMany({ where: roleScope(session), orderBy: { createdAt: "desc" } }),
  ]);

  const skillOptions = skills.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Workflow 草稿</h1>
        <p className="mt-1 text-sm text-slate-500">
          AI 從 KM 來源辨識出的客服情境草稿，確認後會建立成正式的 Agent，可以再到畫布上調整。
        </p>
      </div>

      <div className="space-y-4">
        {drafts.map((d) => (
          <DraftCard
            key={d.id}
            draft={{
              id: d.id,
              sourceTitle: d.source.title,
              suggestedName: d.suggestedName,
              suggestedPrompt: d.suggestedPrompt,
              suggestedSkillIds: Array.isArray(d.suggestedSkillIds) ? (d.suggestedSkillIds as string[]) : [],
              unmatchedNote: d.unmatchedNote,
            }}
            skillOptions={skillOptions}
          />
        ))}
        {drafts.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
            目前沒有待審核的草稿，到「來源管理」的來源頁面按「產生 Workflow 草稿」試試。
          </div>
        )}
      </div>
    </div>
  );
}
