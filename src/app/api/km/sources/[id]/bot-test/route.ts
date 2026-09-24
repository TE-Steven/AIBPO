import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { companyIdForRole } from "@/lib/company";
import { askBot, decodeTokenClaims, getBotTestTarget, BotTokenError, type AskResult } from "@/lib/botTest";

export const dynamic = "force-dynamic";

// 同時跑幾題：每題 customerId 不同互不干擾，但也不要一次灌太多到現行機器人。
const CONCURRENCY = 3;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function resultData(r: AskResult) {
  if (r.status === "ANSWERED") {
    return { status: r.status, customerId: r.customerId, chatId: r.chatId, botAnswer: r.answer, errorMessage: null };
  }
  if (r.status === "TIMEOUT") {
    return { status: r.status, customerId: r.customerId, chatId: null, botAnswer: null, errorMessage: "等了約 2 分鐘仍沒有拿到機器人回答" };
  }
  return { status: r.status, customerId: r.customerId, chatId: null, botAnswer: null, errorMessage: r.errorMessage };
}

// POST body：{ token } 整批測這個來源的全部題目；{ token, resultId } 只重測其中一題。
// token 放在 body（不放 query string），只在這次請求的記憶體裡使用。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return jsonError("請先登入。", 401);
  if (session.kind !== "user") return jsonError("平台超級管理員不能操作公司資料。", 403);

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) return jsonError("找不到這個來源。", 404);
  if (source.roleId !== session.roleId) return jsonError("沒有權限。", 403);

  const body = (await req.json().catch(() => ({}))) as { token?: unknown; resultId?: unknown };
  const token = typeof body.token === "string" ? body.token.trim().replace(/^Bearer\s+/i, "") : "";
  const resultId = typeof body.resultId === "string" ? body.resultId : null;
  if (!token) return jsonError("請填 token。", 400);

  try {
    decodeTokenClaims(token);
  } catch (err) {
    return jsonError(err instanceof BotTokenError ? err.message : "token 格式不正確。", 400);
  }

  const target = await getBotTestTarget(await companyIdForRole(source.roleId));
  if (!target) return jsonError("這間公司還沒設定機器人測試 API，請聯絡平台管理員。", 400);

  // 決定這次要跑哪些題目
  let runId: string;
  let jobs: { id: string; question: string }[];
  const isRetest = Boolean(resultId);

  if (resultId) {
    const existing = await prisma.botTestResult.findUnique({ where: { id: resultId }, include: { run: true } });
    if (!existing || existing.run.sourceId !== id) return jsonError("找不到這筆測試結果。", 404);
    await prisma.botTestResult.update({
      where: { id: resultId },
      data: { status: "PENDING", botAnswer: null, chatId: null, errorMessage: null },
    });
    runId = existing.runId;
    jobs = [{ id: existing.id, question: existing.question }];
  } else {
    const entries = await prisma.kmEntry.findMany({ where: { sourceId: id }, orderBy: { createdAt: "asc" } });
    if (entries.length === 0) return jsonError("這個來源還沒有題目。", 400);
    const run = await prisma.botTestRun.create({
      data: {
        sourceId: id,
        roleId: source.roleId,
        createdById: session.id,
        total: entries.length,
        results: {
          create: entries.map((e, i) => ({
            order: i + 1,
            question: e.question,
            expectedAnswer: e.answer,
            customerId: "",
          })),
        },
      },
      include: { results: { orderBy: { order: "asc" } } },
    });
    runId = run.id;
    jobs = run.results.map((r) => ({ id: r.id, question: r.question }));
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // 使用者關掉頁面：停止推送，但題目照樣跑完、結果照樣寫進 DB。
          closed = true;
        }
      }
      // 每題要等 30 秒以上才有結果，定期送註解行避免中間的 proxy 把閒置連線切掉。
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);

      send("start", { runId, total: jobs.length });

      let tokenError: string | null = null;
      let next = 0;

      async function worker() {
        while (!tokenError && next < jobs.length) {
          const job = jobs[next++];
          try {
            const result = await askBot(target!, token, job.question);
            const data = resultData(result);
            await prisma.botTestResult.update({ where: { id: job.id }, data });
            if (!isRetest) await prisma.botTestRun.update({ where: { id: runId }, data: { completed: { increment: 1 } } });
            send("result", { id: job.id, ...data });
          } catch (err) {
            if (err instanceof BotTokenError) {
              tokenError = err.message;
              await prisma.botTestResult.update({ where: { id: job.id }, data: { status: "ERROR", errorMessage: err.message } });
              send("result", { id: job.id, status: "ERROR", botAnswer: null, errorMessage: err.message });
            } else {
              const message = "寫入測試結果失敗";
              await prisma.botTestResult.update({ where: { id: job.id }, data: { status: "ERROR", errorMessage: message } }).catch(() => {});
              send("result", { id: job.id, status: "ERROR", botAnswer: null, errorMessage: message });
            }
          }
        }
      }

      try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

        if (tokenError) {
          const skipped = jobs.slice(next).map((j) => j.id);
          if (skipped.length > 0) {
            await prisma.botTestResult.updateMany({
              where: { id: { in: skipped } },
              data: { status: "ERROR", errorMessage: "token 失效，這題沒有送出" },
            });
            for (const skippedId of skipped) {
              send("result", { id: skippedId, status: "ERROR", botAnswer: null, errorMessage: "token 失效，這題沒有送出" });
            }
          }
          if (!isRetest) {
            await prisma.botTestRun.update({ where: { id: runId }, data: { status: "FAILED", errorMessage: tokenError } });
          }
          send("done", { status: "FAILED", errorMessage: tokenError });
        } else {
          if (!isRetest) await prisma.botTestRun.update({ where: { id: runId }, data: { status: "DONE" } });
          send("done", { status: "DONE" });
        }
      } catch {
        if (!isRetest) {
          await prisma.botTestRun.update({ where: { id: runId }, data: { status: "FAILED", errorMessage: "測試中斷" } }).catch(() => {});
        }
        send("done", { status: "FAILED", errorMessage: "測試中斷，請重試一次。" });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
