"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession, requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export type AgentActionState = { error?: string };

export async function createAgentAction(
  _prevState: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const session = await requireCompanyUser();

  const name = String(formData.get("name") ?? "").trim();
  const systemPrompt = String(formData.get("systemPrompt") ?? "").trim();
  if (!name) return { error: "名稱不能是空的。" };
  if (!systemPrompt) return { error: "系統提示詞不能是空的。" };

  const agent = await prisma.agent.create({
    data: { name, systemPrompt, roleId: session.roleId, createdById: session.id },
  });

  revalidatePath("/agents");
  redirect(`/agents/${agent.id}`);
}

export async function deleteAgentAction(agentId: string): Promise<void> {
  const session = await requireSession();

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return;
  if (session.kind !== "superadmin" && agent.roleId !== session.roleId) return;

  await prisma.agent.delete({ where: { id: agentId } });
  revalidatePath("/agents");
}
