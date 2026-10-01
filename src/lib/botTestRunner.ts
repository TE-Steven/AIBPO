import { askBot, BotTokenError, type AskResult, type BotTestTarget } from "@/lib/botTest";
import { judgeBotAnswer } from "@/lib/botJudge";
import type { PromptConfigData } from "@/lib/promptConfig";

// 機器人測試的共用執行引擎（來源頁測試、知識庫版本測試、自動優化共用）：
// 同時跑 3 題、每題問機器人＋AI 比對、token 失效整批停止。
// runBotJobs 是核心（promise 版，背景任務直接用）；botTestSseResponse 在外面包一層 SSE 逐題回報與心跳。

const CONCURRENCY = 3;

export type RunnerJob = { id: string; question: string; expectedAnswer: string };

export type RunnerResultData = {
  status: string;
  customerId?: string;
  chatId?: string | null;
  botAnswer: string | null;
  errorMessage: string | null;
  judgeVerdict?: string | null;
  judgeReason?: string | null;
};

export const TOKEN_SKIPPED_MESSAGE = "token 失效，這題沒有送出";

function resultData(r: AskResult): RunnerResultData {
  if (r.status === "ANSWERED") {
    return { status: r.status, customerId: r.customerId, chatId: r.chatId, botAnswer: r.answer, errorMessage: null };
  }
  if (r.status === "TIMEOUT") {
    return { status: r.status, customerId: r.customerId, chatId: null, botAnswer: null, errorMessage: "等了約 2 分鐘仍沒有拿到機器人回答" };
  }
  return { status: r.status, customerId: r.customerId, chatId: null, botAnswer: null, errorMessage: r.errorMessage };
}

export type RunBotJobsParams = {
  jobs: RunnerJob[];
  target: BotTestTarget;
  token: string;
  roleId: string;
  config?: PromptConfigData;
  // 寫入一題的結果（成功或失敗都會呼叫）
  saveResult: (jobId: string, data: RunnerResultData, meta: { completed: boolean }) => Promise<void>;
  // 每題結果出來後通知（SSE 推播用）
  onResult?: (jobId: string, data: RunnerResultData) => void;
  // 每題開始前檢查：回傳 true 就不再送新題目（使用者按停止）
  shouldStop?: () => Promise<boolean>;
};

// 回傳 tokenError（token 失效中斷時）與沒送出的題目
export async function runBotJobs(params: RunBotJobsParams): Promise<{ tokenError: string | null; skipped: string[] }> {
  const { jobs, target, token, roleId, config } = params;
  let tokenError: string | null = null;
  let stopped = false;
  let next = 0;

  async function worker() {
    while (!tokenError && !stopped && next < jobs.length) {
      if (params.shouldStop && (await params.shouldStop())) {
        stopped = true;
        break;
      }
      const job = jobs[next++];
      try {
        const result = await askBot(target, token, job.question);
        // 拿到回答就請 AI 比對標準答案（沒拿到回答的不比對）
        const judge =
          result.status === "ANSWERED"
            ? await judgeBotAnswer({ question: job.question, expectedAnswer: job.expectedAnswer, botAnswer: result.answer, roleId, config })
            : null;
        const data = { ...resultData(result), judgeVerdict: judge?.verdict ?? null, judgeReason: judge?.reason ?? null };
        await params.saveResult(job.id, data, { completed: true });
        params.onResult?.(job.id, data);
      } catch (err) {
        const message = err instanceof BotTokenError ? err.message : "寫入測試結果失敗";
        if (err instanceof BotTokenError) tokenError = err.message;
        const data: RunnerResultData = { status: "ERROR", botAnswer: null, errorMessage: message };
        await params.saveResult(job.id, data, { completed: false }).catch(() => {});
        params.onResult?.(job.id, data);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return { tokenError, skipped: jobs.slice(next).map((j) => j.id) };
}

export function botTestSseResponse(params: {
  runId: string;
  jobs: RunnerJob[];
  target: BotTestTarget;
  token: string;
  roleId: string;
  config?: PromptConfigData;
  saveResult: RunBotJobsParams["saveResult"];
  // token 失效後沒送出的題目
  markSkipped: (jobIds: string[], message: string) => Promise<void>;
  // 整批結束：tokenError 有值＝token 失效中斷；aborted＝發生非預期錯誤
  onFinish: (outcome: { tokenError: string | null; aborted: boolean }) => Promise<void>;
}): Response {
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

      send("start", { runId: params.runId, total: params.jobs.length });

      try {
        const { tokenError, skipped } = await runBotJobs({
          ...params,
          onResult: (id, data) => send("result", { id, ...data }),
        });
        if (tokenError) {
          if (skipped.length > 0) {
            await params.markSkipped(skipped, TOKEN_SKIPPED_MESSAGE);
            for (const skippedId of skipped) {
              send("result", { id: skippedId, status: "ERROR", botAnswer: null, errorMessage: TOKEN_SKIPPED_MESSAGE });
            }
          }
          await params.onFinish({ tokenError, aborted: false });
          send("done", { status: "FAILED", errorMessage: tokenError });
        } else {
          await params.onFinish({ tokenError: null, aborted: false });
          send("done", { status: "DONE" });
        }
      } catch {
        await params.onFinish({ tokenError: null, aborted: true }).catch(() => {});
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
