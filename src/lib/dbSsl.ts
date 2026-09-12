/**
 * Render 的 Postgres（不管 internal 還是 external 網址）用自簽憑證，pg 函式庫近版
 * 把 connection string 裡的 sslmode=require 之類的參數解讀得很嚴格（等同 verify-full），
 * 自簽憑證一定會被拒絕。與其依賴連線字串裡的 query string 參數（不同版本行為不一致、
 * 也不好從外部除錯），這裡直接用程式碼決定 SSL 設定：本機 localhost 不加密（docker-compose
 * 的本地 Postgres 沒開 SSL），其餘一律加密但不驗證憑證鏈（等同傳統 libpq 的 sslmode=require）。
 */
export function resolveSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  try {
    const { hostname } = new URL(connectionString);
    if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  } catch {
    // 缺少/格式不完整的連線字串留給實際查詢時的連線錯誤處理，這裡不拋錯。
  }
  return { rejectUnauthorized: false };
}
