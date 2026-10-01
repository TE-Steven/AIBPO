// 伺服器啟動時執行一次：自動優化的 token 只放在記憶體裡，重新啟動（例如 Render 部署）後就不見了，
// 把還標著 RUNNING 的任務改成 PAUSED_TOKEN，使用者貼新 token 就會從中斷的那一步繼續。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 只在 Render 上做：本機開發連的是同一個資料庫，不能因為本機重開就把正式環境正在跑的任務暫停
  if (!process.env.RENDER) return;
  try {
    const { prisma } = await import("@/lib/db");
    await prisma.optimizationJob.updateMany({
      where: { status: "RUNNING" },
      data: { status: "PAUSED_TOKEN", currentStep: "伺服器重新啟動，請貼新的 token 繼續。" },
    });
  } catch (err) {
    // 資料庫連不上不能擋住伺服器啟動
    console.error("自動優化任務狀態重設失敗", err);
  }
}
