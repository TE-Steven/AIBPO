// 前後端共用、不依賴 Node API 的機器人測試小工具。

const DISCLAIMER_PATTERN = /\s*※本內容由AI生成[^\n]*\s*$/;

// 機器人回答尾巴固定會帶一段「※本內容由AI生成…」免責聲明，DB 存原文，畫面上顯示時去掉。
export function stripBotDisclaimer(answer: string): string {
  return answer.replace(DISCLAIMER_PATTERN, "").trimEnd();
}
