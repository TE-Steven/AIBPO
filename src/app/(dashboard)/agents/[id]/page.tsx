import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AgentCanvas } from "./AgentCanvas";
import { AgentChatPanel } from "./AgentChatPanel";
import { IconArrowLeft } from "@/components/icons";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { agentSkills: { include: { skill: true } } },
  });
  if (!agent) notFound();
  if (session.kind !== "superadmin" && agent.roleId !== session.roleId) notFound();

  const availableSkills = await prisma.skill.findMany({
    where: roleScope(session),
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <IconArrowLeft className="h-4 w-4" />
          返回 Agent 管理
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{agent.name}</h1>
        <p className="mt-1 text-sm text-slate-500">把左側的 Skill 拖到畫布上連到 Agent 節點，存檔後右下角就能開始對話。</p>
      </div>

      <AgentCanvas
        agentId={agent.id}
        initialName={agent.name}
        initialSystemPrompt={agent.systemPrompt}
        availableSkills={availableSkills.map((s) => ({ id: s.id, name: s.name, description: s.description }))}
        initialAgentSkills={agent.agentSkills.map((as) => ({
          skillId: as.skillId,
          name: as.skill.name,
          description: as.skill.description,
          positionX: as.positionX,
          positionY: as.positionY,
        }))}
      />

      <AgentChatPanel agentId={agent.id} />
    </div>
  );
}
