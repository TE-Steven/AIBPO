import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { companyIdForRole } from "@/lib/company";
import { decodeTokenClaims, getBotTestTarget, BotTokenError } from "@/lib/botTest";
import { botTestSseResponse } from "@/lib/botTestRunner";
import { getPromptConfig } from "@/lib/promptConfigStore";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// 用固定測試題庫測某個知識庫版本（前提：使用者已經把這一版的檔案上傳到 chatbot）。
// POST body { token }：token 只在這次請求的記憶體裡使用，不存 DB。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return jsonError("請先登入。", 401);
  if (session.kind !== "user") return jsonError("平台超級管理員不能操作公司資料。", 403);

  const version = await prisma.kbVersion.findUnique({ where: { id } });
  if (!version || version.roleId !== session.roleId) return jsonError("找不到這個版本。", 404);

  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim().replace(/^Bearer\s+/i, "") : "";
  if (!token) return jsonError("請填 token。", 400);
  try {
    decodeTokenClaims(token);
  } catch (err) {
    return jsonError(err instanceof BotTokenError ? err.message : "token 格式不正確。", 400);
  }

  const companyId = await companyIdForRole(version.roleId);
  const [target, promptConfig, testCases] = await Promise.all([
    getBotTestTarget(companyId),
    getPromptConfig(companyId),
    prisma.testCase.findMany({ where: { roleId: version.roleId, archived: false }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
  ]);
  if (!target) return jsonError("這間公司還沒設定機器人測試 API，請聯絡平台管理員。", 400);
  if (testCases.length === 0) return jsonError("測試題庫是空的：請先在「題目」分頁勾選 FAQ 加入測試題庫，或在「測試題庫」分頁新增。", 400);

  const run = await prisma.versionTestRun.create({
    data: {
      versionId: version.id,
      roleId: version.roleId,
      createdById: session.id,
      total: testCases.length,
      results: {
        create: testCases.map((t, i) => ({
          testCaseId: t.id,
          order: i + 1,
          question: t.question,
          expectedAnswer: t.expectedAnswer,
          customerId: "",
        })),
      },
    },
    include: { results: { orderBy: { order: "asc" } } },
  });

  return botTestSseResponse({
    runId: run.id,
    jobs: run.results.map((r) => ({ id: r.id, question: r.question, expectedAnswer: r.expectedAnswer })),
    target,
    token,
    roleId: version.roleId,
    config: promptConfig,
    saveResult: async (jobId, data, meta) => {
      await prisma.versionTestResult.update({ where: { id: jobId }, data });
      if (meta.completed) await prisma.versionTestRun.update({ where: { id: run.id }, data: { completed: { increment: 1 } } });
    },
    markSkipped: async (jobIds, message) => {
      await prisma.versionTestResult.updateMany({ where: { id: { in: jobIds } }, data: { status: "ERROR", errorMessage: message } });
    },
    onFinish: async ({ tokenError, aborted }) => {
      await prisma.versionTestRun.update({
        where: { id: run.id },
        data: tokenError || aborted ? { status: "FAILED", errorMessage: tokenError ?? "測試中斷" } : { status: "DONE" },
      });
    },
  });
}
