"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { checkFormUrl } from "@/lib/automationUrl";
import { cleanFields, type AutomationField } from "@/lib/automationFields";

// 自動化管理：登記表單、重新分析、修改欄位清單、刪除。分析由瀏覽器 Worker 在背景做（AutomationJob）。

export type AutomationActionResult = { success?: string; error?: string };

const PATH = "/automations";

async function ownForm(id: string, roleId: string) {
  const form = await prisma.automationForm.findUnique({ where: { id } });
  return form && form.roleId === roleId ? form : null;
}

// 登記一張表單並排入分析；必須確認是公司自己的表單或已取得授權
export async function createAutomationFormAction(input: { name: string; url: string; authorized: boolean }): Promise<AutomationActionResult> {
  const session = await requireCompanyUser();
  const name = input.name.trim();
  if (!name) return { error: "請輸入表單名稱。" };
  if (!input.authorized) return { error: "請確認這是公司自己的表單，或已取得表單擁有者授權可以自動填寫。" };
  const checked = await checkFormUrl(input.url);
  if ("error" in checked) return { error: checked.error };
  const now = new Date();
  const form = await prisma.automationForm.create({
    data: {
      roleId: session.roleId,
      name: name.slice(0, 100),
      url: checked.url,
      domain: checked.domain,
      authorizedBy: session.displayName,
      authorizedAt: now,
      createdById: session.id,
      jobs: { create: { type: "ANALYZE" } },
    },
  });
  revalidatePath(PATH);
  redirect(`${PATH}/${form.id}`);
}

// 重新分析（表單改版、上次分析失敗）
export async function reanalyzeAutomationFormAction(id: string): Promise<AutomationActionResult> {
  const session = await requireCompanyUser();
  const form = await ownForm(id, session.roleId);
  if (!form) return { error: "找不到這張表單。" };
  const running = await prisma.automationJob.count({ where: { formId: id, type: "ANALYZE", status: { in: ["PENDING", "RUNNING"] } } });
  if (running > 0) return { error: "這張表單正在分析中。" };
  await prisma.$transaction([
    prisma.automationForm.update({ where: { id }, data: { status: "DRAFT", errorMessage: null } }),
    prisma.automationJob.create({ data: { formId: id, type: "ANALYZE" } }),
  ]);
  revalidatePath(`${PATH}/${id}`);
  return { success: "已排入重新分析，完成後欄位清單會更新（原本的修改會被覆蓋）。" };
}

// 儲存管理員修改後的欄位清單
export async function saveAutomationFieldsAction(id: string, fields: AutomationField[]): Promise<AutomationActionResult> {
  const session = await requireCompanyUser();
  const form = await ownForm(id, session.roleId);
  if (!form) return { error: "找不到這張表單。" };
  const cleaned = cleanFields(fields);
  if (cleaned.length === 0) return { error: "至少要有一個欄位。" };
  await prisma.automationForm.update({ where: { id }, data: { fields: cleaned } });
  revalidatePath(`${PATH}/${id}`);
  return { success: "已儲存欄位清單。" };
}

export async function deleteAutomationFormAction(id: string): Promise<AutomationActionResult> {
  const session = await requireCompanyUser();
  const form = await ownForm(id, session.roleId);
  if (!form) return { error: "找不到這張表單。" };
  await prisma.automationForm.delete({ where: { id } });
  revalidatePath(PATH);
  redirect(PATH);
}
