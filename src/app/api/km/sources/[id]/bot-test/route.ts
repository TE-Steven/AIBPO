import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { companyIdForRole } from "@/lib/company";
import { askBot, decodeTokenClaims, getBotTestTarget, BotTokenError, type AskResult } from "@/lib/botTest";
import { judgeBotAnswer } from "@/lib/botJudge";

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

// POST body：
// - { token }：第一次測試，建立一次新的測試、把來源的全部題目送出（已經測過的來源不能再用這個，要用重新測試）。
// - { token, runId, resultIds, entryIds }：重新測試。resultIds 是這次測試裡要重問的題目（新結果覆蓋舊的），
//   entryIds 是測試之後才新增、還不在這次測試裡的題目（會加進這次測試再送出）。
// token 放在 body（不放 query string），只在這次請求的記憶體裡使用。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return jsonError("請先登入。", 401);
  if (session.kind !== "user") return jsonError("平台超級管理員不能操作公司資料。", 403);

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) return jsonError("找不到這個來源。", 404);
  if (source.roleId !== session.roleId) return jsonError("沒有權限。", 403);

  const body = (await req.json().catch(() => ({}))) as { token?: unknown; runId?: unknown; resultIds?: unknown; entryIds?: unknown };
  const token = typeof body.token === "string" ? body.token.trim().replace(/^Bearer\s+/i, "") : "";
  const retestRunId = typeof body.runId === "string" ? body.runId : null;
  const stringIds = (value: unknown) =>
    Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string"))] : [];
  const resultIds = stringIds(body.resultIds);
  const entryIds = stringIds(body.entryIds);
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
  let jobs: { id: string; question: string; expectedAnswer: string }[];
  const isRetest = Boolean(retestRunId);

  if (retestRunId) {
    if (resultIds.length === 0 && entryIds.length === 0) return jsonError("請勾選要重新測試的題目。", 400);
    const run = await prisma.botTestRun.findUnique({ where: { id: retestRunId }, include: { results: true } });
    if (!run || run.sourceId !== id) return jsonError("找不到這次測試。", 404);

    // 重測：只能挑這次測試裡的題目，新結果覆蓋舊的。
    const existing = await prisma.botTestResult.findMany({
      where: { id: { in: resultIds }, runId: run.id },
      include: { entry: true },
    });
    if (existing.length !== resultIds.length) return jsonError("找不到要重測的題目。", 404);

    // 新題目：屬於這個來源、而且還不在這次測試裡。
    const linkedEntryIds = new Set(run.results.map((r) => r.entryId));
    const newEntries = await prisma.kmEntry.findMany({
      where: { id: { in: entryIds }, sourceId: id },
      orderBy: { createdAt: "asc" },
    });
    if (newEntries.length !== entryIds.length || newEntries.some((e) => linkedEntryIds.has(e.id))) {
      return jsonError("新題目已經在這次測試裡，請重新整理頁面後再試。", 400);
    }
    const nextOrder = Math.max(0, ...run.results.map((r) => r.order)) + 1;

    // 重測送出題目列表上最新的題目；快照同步更新成這次實際送出的內容。
    const [, created] = await prisma.$transaction([
      prisma.botTestRun.update({ where: { id: run.id }, data: { total: run.results.length + newEntries.length } }),
      prisma.botTestResult.createManyAndReturn({
        data: newEntries.map((e, i) => ({
          runId: run.id,
          entryId: e.id,
          order: nextOrder + i,
          question: e.question,
          expectedAnswer: e.answer,
          customerId: "",
        })),
      }),
      ...existing.map((r) =>
        prisma.botTestResult.update({
          where: { id: r.id },
          data: {
            question: r.entry?.question ?? r.question,
            expectedAnswer: r.entry?.answer ?? r.expectedAnswer,
            status: "PENDING",
            botAnswer: null,
            chatId: null,
            errorMessage: null,
            judgeVerdict: null,
            judgeReason: null,
          },
        }),
      ),
    ]);
    runId = run.id;
    jobs = [
      ...existing
        .sort((a, b) => a.order - b.order)
        .map((r) => ({ id: r.id, question: r.entry?.question ?? r.question, expectedAnswer: r.entry?.answer ?? r.expectedAnswer })),
      ...created.map((r) => ({ id: r.id, question: r.question, expectedAnswer: r.expectedAnswer })),
    ];
  } else {
    if ((await prisma.botTestRun.count({ where: { sourceId: id } })) > 0) {
      return jsonError("這個來源已經測試過，請用「重新測試」。", 400);
    }
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
            entryId: e.id,
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
    jobs = run.results.map((r) => ({ id: r.id, question: r.question, expectedAnswer: r.expectedAnswer }));
  }

  const roleId = source.roleId;
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
            // 拿到回答就請 AI 比對標準答案（沒拿到回答的不比對）
            const judge =
              result.status === "ANSWERED"
                ? await judgeBotAnswer({
                    question: job.question,
                    expectedAnswer: job.expectedAnswer,
                    botAnswer: result.answer,
                    roleId,
                  })
                : null;
            const data = { ...resultData(result), judgeVerdict: judge?.verdict ?? null, judgeReason: judge?.reason ?? null };
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
          if (isRetest) {
            // 重測補齊了之前因 token 失效沒送出的題目時，這次測試就不再算「中斷」。
            const [pending, notSent, done] = await Promise.all([
              prisma.botTestResult.count({ where: { runId, status: "PENDING" } }),
              prisma.botTestResult.count({ where: { runId, errorMessage: { contains: "token 失效" } } }),
              prisma.botTestResult.count({ where: { runId, status: { not: "PENDING" } } }),
            ]);
            await prisma.botTestRun.update({
              where: { id: runId },
              data: pending === 0 && notSent === 0 ? { status: "DONE", errorMessage: null, completed: done } : { completed: done },
            });
          } else {
            await prisma.botTestRun.update({ where: { id: runId }, data: { status: "DONE" } });
          }
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
