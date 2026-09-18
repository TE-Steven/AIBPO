"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export type CanvasSkillPlacement = { skillId: string; positionX: number; positionY: number };

export type SaveCanvasResult = { success?: string; error?: string };

export async function saveAgentCanvasAction(
  agentId: string,
  data: { name: string; systemPrompt: string; skills: CanvasSkillPlacement[] },
): Promise<SaveCanvasResult> {
  const session = await requireSession();

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { error: "找不到這個 Agent。" };
  if (session.kind !== "superadmin" && agent.roleId !== session.roleId) {
    return { error: "沒有權限編輯這個 Agent。" };
  }

  const name = data.name.trim();
  const systemPrompt = data.systemPrompt.trim();
  if (!name) return { error: "名稱不能是空的。" };
  if (!systemPrompt) return { error: "系統提示詞不能是空的。" };

  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agentId },
      data: { name, systemPrompt, status: "ACTIVE" },
    }),
    prisma.agentSkill.deleteMany({ where: { agentId } }),
    ...(data.skills.length > 0
      ? [
          prisma.agentSkill.createMany({
            data: data.skills.map((s) => ({
              agentId,
              skillId: s.skillId,
              positionX: s.positionX,
              positionY: s.positionY,
            })),
          }),
        ]
      : []),
  ]);

  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/agents");
  return { success: "已儲存。" };
}
