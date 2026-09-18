"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export type DraftActionState = { success?: string; error?: string };

async function firstRoleId(): Promise<string> {
  const role = await prisma.role.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  return role.id;
}

const AGENT_CENTER = { x: 380, y: 220 };
const SATELLITE_RADIUS = 220;

function circlePosition(index: number, total: number) {
  const angle = (2 * Math.PI * index) / Math.max(total, 1);
  return {
    x: AGENT_CENTER.x + SATELLITE_RADIUS * Math.cos(angle),
    y: AGENT_CENTER.y + SATELLITE_RADIUS * Math.sin(angle),
  };
}

export async function confirmAgentDraftAction(
  draftId: string,
  data: { name: string; systemPrompt: string; skillIds: string[] },
): Promise<DraftActionState> {
  const session = await requireSession();

  const draft = await prisma.agentDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { error: "找不到這筆草稿。" };
  if (session.kind !== "superadmin" && draft.roleId !== session.roleId) {
    return { error: "沒有權限操作這筆草稿。" };
  }

  const name = data.name.trim();
  const systemPrompt = data.systemPrompt.trim();
  if (!name) return { error: "名稱不能是空的。" };
  if (!systemPrompt) return { error: "系統提示詞不能是空的。" };

  const roleId = session.kind === "superadmin" ? await firstRoleId() : session.roleId;
  const createdById = session.kind === "superadmin" ? "superadmin" : session.id;

  const agent = await prisma.$transaction(async (tx) => {
    const created = await tx.agent.create({
      data: { name, systemPrompt, status: "ACTIVE", roleId, createdById },
    });
    if (data.skillIds.length > 0) {
      await tx.agentSkill.createMany({
        data: data.skillIds.map((skillId, i) => {
          const pos = circlePosition(i, data.skillIds.length);
          return { agentId: created.id, skillId, positionX: pos.x, positionY: pos.y };
        }),
      });
    }
    await tx.agentDraft.update({ where: { id: draftId }, data: { confirmed: true, confirmedAgentId: created.id } });
    return created;
  });

  revalidatePath("/agents/drafts");
  revalidatePath("/agents");
  return { success: `已建立 Agent「${agent.name}」，可以到 Agent 管理繼續調整畫布。` };
}

export async function rejectAgentDraftAction(draftId: string): Promise<void> {
  const session = await requireSession();

  const draft = await prisma.agentDraft.findUnique({ where: { id: draftId } });
  if (!draft) return;
  if (session.kind !== "superadmin" && draft.roleId !== session.roleId) return;

  await prisma.agentDraft.delete({ where: { id: draftId } });
  revalidatePath("/agents/drafts");
}
