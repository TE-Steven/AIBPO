import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AgentCreateForm } from "./AgentCreateForm";
import { deleteAgentAction } from "./actions";
import { ClickableRow } from "@/components/ClickableRow";
import { IconSparkles, IconTrash } from "@/components/icons";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "bg-slate-100 text-slate-500" },
  ACTIVE: { label: "已啟用", className: "bg-emerald-50 text-emerald-600" },
};

export default async function AgentsPage() {
  const session = await requireSession();

  const agents = await prisma.agent.findMany({
    where: roleScope(session),
    include: { _count: { select: { agentSkills: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Agent 管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          在畫布上把 Skill 拖給 Agent，組成一個具備多種能力、可以直接對話下指令的 AI 助手。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">新增 Agent</h2>
        <AgentCreateForm />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">名稱</th>
              <th className="px-5 py-3">狀態</th>
              <th className="px-5 py-3">Skill 數量</th>
              <th className="px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.map((a) => {
              const status = STATUS_LABEL[a.status] ?? STATUS_LABEL.DRAFT;
              return (
                <ClickableRow key={a.id} href={`/agents/${a.id}`} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5 font-medium text-slate-800">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                        <IconSparkles className="h-3.5 w-3.5" />
                      </span>
                      {a.name}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{a._count.agentSkills}</td>
                  <td className="px-5 py-3">
                    <form action={deleteAgentAction.bind(null, a.id)}>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                        刪除
                      </button>
                    </form>
                  </td>
                </ClickableRow>
              );
            })}
            {agents.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">
                  尚未建立任何 Agent
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
