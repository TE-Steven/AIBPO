"use client";

import { useEffect, useState } from "react";

/**
 * Server Component 裡直接呼叫 toLocaleString 會用「伺服器」的時區（Render 上通常是 UTC），
 * 不是瀏覽這個頁面的人的時區。這裡改在 Client Component 掛載後才格式化，確保用的是
 * 使用者瀏覽器的本地時區。掛載前先顯示 ISO 日期當作安全的預設值，避免 SSR/CSR 內容對不上。
 */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => iso.slice(0, 10));

  useEffect(() => {
    setText(new Date(iso).toLocaleString("zh-TW"));
  }, [iso]);

  return <span suppressHydrationWarning>{text}</span>;
}
