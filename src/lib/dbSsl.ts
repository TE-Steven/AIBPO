/**
 * Render 的 Postgres（不管 internal 還是 external 網址）用自簽憑證，pg 函式庫近版
 * 把 connection string 裡的 sslmode=require 之類的參數解讀得很嚴格（等同 verify-full），
 * 自簽憑證一定會被拒絕。SSL 行為改成完全由程式碼決定，不依賴連線字串裡的 query
 * string（不同版本 pg 函式庫解讀不一致，也很難從外部除錯）：本機 localhost 不加密
 * （docker-compose 的本地 Postgres 沒開 SSL），其餘一律加密但不驗證憑證鏈（等同
 * 傳統 libpq 的 sslmode=require）。
 *
 * 連線字串裡如果殘留 sslmode / uselibpqcompat 參數（例如環境變數還沒來得及更新），
 * pg 函式庫可能會以連線字串裡的設定為準蓋過我們明確傳入的 ssl 選項，所以這裡連同
 * 那些參數一起從連線字串上拿掉，確保實際生效的一定是下面算出來的這組設定。
 */
export function resolveConnection(rawUrl: string): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean };
} {
  try {
    const url = new URL(rawUrl);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    url.searchParams.delete("sslmode");
    url.searchParams.delete("uselibpqcompat");
    return { connectionString: url.toString(), ssl: isLocal ? false : { rejectUnauthorized: false } };
  } catch {
    // 缺少/格式不完整的連線字串留給實際查詢時的連線錯誤處理，這裡不拋錯。
    return { connectionString: rawUrl, ssl: { rejectUnauthorized: false } };
  }
}
