"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildKnowledgeMarkdown, tallyPathOf, type ExportEntry } from "@/lib/kmExport";
import { getPromptConfig } from "@/lib/promptConfigStore";
import { resolveOptions } from "@/lib/promptConfig";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { tallyPathOptions } from "@/lib/tallyTree";

export type KnowledgeActionResult = { success?: string; error?: string };

const PATH = "/km/knowledge";

// ---------------- 知識庫版本 ----------------

// 建立版本：凍結勾選題目的內容與匯出全文，並記下當時的 Prompt 設定、最高準則與分類描述，日後追查版本差異用。
export async function createVersionAction(input: {
  entryIds: string[];
  name: string;
  note: string;
  includeFaq: boolean;
  includeDocs: boolean;
}): Promise<KnowledgeActionResult & { versionId?: string }> {
  const session = await requireCompanyUser();
  if (!input.includeFaq && !input.includeDocs) return { error: "請至少選擇包含 FAQ 或結構化文件其中一種。" };

  const kinds = [...(input.includeFaq ? ["FAQ"] : []), ...(input.includeDocs ? ["DOC"] : [])];
  const entries = await prisma.kmEntry.findMany({
    where: { id: { in: input.entryIds }, roleId: session.roleId, confirmed: true, kind: { in: kinds } },
    include: { tally: { include: { parent: { include: { parent: true } } } }, source: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (entries.length === 0) return { error: "沒有可以放進版本的題目（只會放已加入知識列表、且符合所選類型的題目）。" };

  const [promptConfig, guidelines, tallies, versionCount] = await Promise.all([
    getPromptConfig(session.companyId),
    getSystemSetting(session.companyId, KM_OUTPUT_GUIDELINES_KEY),
    prisma.tally.findMany({ where: { roleId: session.roleId }, orderBy: { order: "asc" } }),
    prisma.kbVersion.count({ where: { roleId: session.roleId } }),
  ]);

  const name = input.name.trim() || `v${versionCount + 1}`;
  const snapshot: ExportEntry[] = entries.map((e) => ({
    kind: e.kind,
    question: e.question,
    answer: e.answer,
    tallyPath: tallyPathOf(e.tally),
    sourceTitle: e.source.title,
  }));
  const markdown = buildKnowledgeMarkdown({
    entries: snapshot,
    options: resolveOptions(promptConfig),
    format: "md",
    exportedAt: new Date(),
    title: `KM 知識庫 ${name}`,
  });

  const version = await prisma.kbVersion.create({
    data: {
      roleId: session.roleId,
      name,
      note: input.note.trim() || null,
      createdById: session.id,
      markdown,
      entries: snapshot,
      entryCount: snapshot.length,
      settings: {
        promptConfig: promptConfig as object,
        guidelines,
        tallies: tallyPathOptions(tallies).map((t) => ({ path: t.path, description: t.description })),
      },
    },
  });

  revalidatePath(PATH);
  return { success: `已建立版本「${name}」（${snapshot.length} 題）。下載後上傳到 chatbot，再用測試題庫測試。`, versionId: version.id };
}

export async function updateVersionAction(versionId: string, input: { name: string; note: string }): Promise<KnowledgeActionResult> {
  const session = await requireCompanyUser();
  const version = await prisma.kbVersion.findUnique({ where: { id: versionId } });
  if (!version || version.roleId !== session.roleId) return { error: "找不到這個版本。" };
  const name = input.name.trim();
  if (!name) return { error: "版本名稱不能是空的。" };

  await prisma.kbVersion.update({ where: { id: versionId }, data: { name, note: input.note.trim() || null } });
  revalidatePath(PATH);
  return { success: "已儲存。" };
}

// 刪除版本：連同它的測試紀錄一起刪除（測試題庫本身不受影響）
export async function deleteVersionAction(versionId: string): Promise<KnowledgeActionResult> {
  const session = await requireCompanyUser();
  const version = await prisma.kbVersion.findUnique({ where: { id: versionId } });
  if (!version || version.roleId !== session.roleId) return { error: "找不到這個版本。" };

  await prisma.kbVersion.delete({ where: { id: versionId } });
  revalidatePath(PATH);
  return { success: `已刪除版本「${version.name}」。` };
}

// ---------------- 測試題庫 ----------------

// 把勾選的 FAQ 複製成測試題（題目＋標準答案）；題庫裡已經有同樣題目的會略過
export async function addToTestBankAction(entryIds: string[]): Promise<KnowledgeActionResult> {
  const session = await requireCompanyUser();
  const entries = await prisma.kmEntry.findMany({
    where: { id: { in: entryIds }, roleId: session.roleId, kind: "FAQ" },
    orderBy: { createdAt: "asc" },
  });
  if (entries.length === 0) return { error: "請勾選 FAQ（結構化文件不適合當測試題）。" };

  const existing = await prisma.testCase.findMany({ where: { roleId: session.roleId }, select: { question: true, order: true } });
  const existingQuestions = new Set(existing.map((t) => t.question.trim()));
  let order = Math.max(0, ...existing.map((t) => t.order));
  const toAdd = entries.filter((e) => !existingQuestions.has(e.question.trim()));

  if (toAdd.length > 0) {
    await prisma.testCase.createMany({
      data: toAdd.map((e) => ({
        roleId: session.roleId,
        question: e.question,
        expectedAnswer: e.answer,
        entryId: e.id,
        order: ++order,
      })),
    });
  }
  revalidatePath(PATH);
  const skipped = entries.length - toAdd.length;
  return { success: `已加入 ${toAdd.length} 題到測試題庫${skipped > 0 ? `（${skipped} 題已在題庫裡，略過）` : ""}。` };
}

export async function createTestCaseAction(input: { question: string; expectedAnswer: string }): Promise<KnowledgeActionResult> {
  const session = await requireCompanyUser();
  const question = input.question.trim();
  const expectedAnswer = input.expectedAnswer.trim();
  if (!question || !expectedAnswer) return { error: "題目與標準答案都要填。" };

  const last = await prisma.testCase.findFirst({ where: { roleId: session.roleId }, orderBy: { order: "desc" } });
  await prisma.testCase.create({ data: { roleId: session.roleId, question, expectedAnswer, order: (last?.order ?? 0) + 1 } });
  revalidatePath(PATH);
  return { success: "已新增測試題。" };
}

export async function updateTestCaseAction(testCaseId: string, input: { question: string; expectedAnswer: string }): Promise<KnowledgeActionResult> {
  const session = await requireCompanyUser();
  const testCase = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!testCase || testCase.roleId !== session.roleId) return { error: "找不到這一題。" };
  const question = input.question.trim();
  const expectedAnswer = input.expectedAnswer.trim();
  if (!question || !expectedAnswer) return { error: "題目與標準答案都要填。" };

  await prisma.testCase.update({ where: { id: testCaseId }, data: { question, expectedAnswer } });
  revalidatePath(PATH);
  return { success: "已儲存。" };
}

// 停用／啟用：停用的題目之後的版本測試不會再問，但歷史結果保留、比較時仍看得到
export async function setTestCaseArchivedAction(testCaseId: string, archived: boolean): Promise<KnowledgeActionResult> {
  const session = await requireCompanyUser();
  const testCase = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!testCase || testCase.roleId !== session.roleId) return { error: "找不到這一題。" };

  await prisma.testCase.update({ where: { id: testCaseId }, data: { archived } });
  revalidatePath(PATH);
  return { success: archived ? "已停用這一題。" : "已重新啟用這一題。" };
}
