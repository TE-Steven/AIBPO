import Anthropic from "@anthropic-ai/sdk";

// 上傳到 Claude 的檔案屬於當時 API key 的工作區（workspace）：換成別的工作區的 key 後，舊檔案會「找不到」

export function isMissingFileError(err: unknown): boolean {
  return err instanceof Anthropic.APIError && /file/i.test(err.message) && /not found|not_found|does not exist/i.test(err.message);
}

// 錯誤訊息轉成給使用者看的文字；找不到檔案時說明怎麼處理
export function aiErrorText(err: unknown, fallback = "未知錯誤"): string {
  const message = err instanceof Error ? err.message : fallback;
  if (!isMissingFileError(err)) return message;
  return `Claude 找不到來源上傳過的檔案（API key 換到不同的工作區後，舊工作區的檔案就讀不到了）：請到來源頁的「來源檔案」按「重新上傳檔案」，FAQ 與其他結果都會保留。（${message}）`;
}
