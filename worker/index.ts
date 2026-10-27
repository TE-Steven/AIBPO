import { chromium, type Browser } from "playwright-core";
import { prisma } from "@/lib/db";
import { analyzeFormCapture } from "@/lib/automationAnalysis";
import { checkFormUrl } from "@/lib/automationUrl";
import { capturePage } from "./capture";

// 自動化管理的瀏覽器 Worker（Render Background Worker，Docker 內含 Chromium）：
// 輪詢資料庫裡 PENDING 的工作，一次做一件。目前支援 ANALYZE（分析表單欄位）。
// 網站只負責登記與查詢結果，兩邊透過 aibpo_automation_jobs 這張表溝通。

const POLL_MS = 3_000;
// RUNNING 超過這麼久還沒結束（例如 Worker 重啟），視為中斷、放回佇列重做
const STALE_MS = 15 * 60_000;
// 截圖太大就不存（存在資料庫的文字欄位）
const MAX_SCREENSHOT_CHARS = 2_500_000;

let browser: Browser | null = null;
let stopping = false;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  return browser;
}

async function claimJob() {
  const job = await prisma.automationJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  if (!job) return null;
  // 只有一個 Worker 也照樣用條件更新搶工作，之後要開多個 Worker 不會重複做
  const claimed = await prisma.automationJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date() } });
  return claimed.count === 1 ? job : null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runAnalyze(jobId: string, formId: string) {
  const form = await prisma.automationForm.findUnique({ where: { id: formId } });
  if (!form) throw new Error("表單已被刪除");
  await prisma.automationForm.update({ where: { id: formId }, data: { status: "ANALYZING", errorMessage: null } });
  try {
    const checked = await checkFormUrl(form.url);
    if ("error" in checked) throw new Error(checked.error);
    const { capture, blockers } = await capturePage(await getBrowser(), form.url);
    const screenshot = capture.screenshot && capture.screenshot.length <= MAX_SCREENSHOT_CHARS ? capture.screenshot : null;
    if (blockers.length > 0) {
      await prisma.automationForm.update({
        where: { id: formId },
        data: { status: "BLOCKED", screenshot, pageInfo: { title: capture.title, description: "", submitText: capture.submitText, blockers, notes: "" }, analyzedAt: new Date() },
      });
      await prisma.automationJob.update({ where: { id: jobId }, data: { status: "DONE", finishedAt: new Date(), result: { blockers } } });
      return;
    }
    const { fields, pageInfo } = await analyzeFormCapture({ ...capture, screenshot }, form.roleId);
    await prisma.automationForm.update({
      where: { id: formId },
      data: { status: fields.length > 0 ? "READY" : "FAILED", fields, pageInfo: { ...pageInfo, blockers: [] }, screenshot, analyzedAt: new Date(), errorMessage: fields.length > 0 ? null : "頁面上沒有找到可以填寫的欄位" },
    });
    await prisma.automationJob.update({ where: { id: jobId }, data: { status: "DONE", finishedAt: new Date(), result: { fieldCount: fields.length } } });
  } catch (err) {
    await prisma.automationForm.update({ where: { id: formId }, data: { status: "FAILED", errorMessage: errorText(err) } });
    throw err;
  }
}

async function loop() {
  // 啟動時把上次中斷的工作放回佇列
  await prisma.automationJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: "PENDING", startedAt: null },
  });
  console.log("AIBPO 瀏覽器 Worker 已啟動，等待工作…");
  while (!stopping) {
    let job: Awaited<ReturnType<typeof claimJob>> = null;
    try {
      job = await claimJob();
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      console.log(`開始 ${job.type} ${job.id}`);
      if (job.type === "ANALYZE") await runAnalyze(job.id, job.formId);
      else throw new Error(`不支援的工作類型 ${job.type}`);
      console.log(`完成 ${job.id}`);
    } catch (err) {
      console.error("工作失敗", job?.id, err);
      if (job) {
        await prisma.automationJob
          .update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: errorText(err) } })
          .catch(() => {});
      } else {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
  }
}

async function shutdown() {
  stopping = true;
  await browser?.close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

loop().catch(async (err) => {
  console.error("Worker 停止", err);
  await shutdown();
});
