"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export type AgentActionState = { error?: string };

async function firstRoleId(): Promise<string> {
  const role = await prisma.role.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  return role.id;
}

export async function createAgentAction(
  _prevState: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const session = await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const systemPrompt = String(formData.get("systemPrompt") ?? "").trim();
  if (!name) return { error: "名稱不能是空的。" };
  if (!systemPrompt) return { error: "系統提示詞不能是空的。" };

  const roleId = session.kind === "superadmin" ? await firstRoleId() : session.roleId;
  const createdById = session.kind === "superadmin" ? "superadmin" : session.id;

  const agent = await prisma.agent.create({ data: { name, systemPrompt, roleId, createdById } });

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
