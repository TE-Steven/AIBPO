"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdmin } from "@/lib/session";
import { appBaseUrl, getLineSettings, isLineConfigured, notifyCompany, removeLineGroup, saveLineCredentials } from "@/lib/lineNotify";

// 參數管理 → LINE 通知：公司管理員設定這間公司的 LINE 機器人金鑰、管理綁定的群組

export type LineActionResult = { success?: string; error?: string };

const PATH = "/settings/prompts";

// 儲存金鑰（留空＝不變）；存好的金鑰不會再傳回瀏覽器
export async function saveLineCredentialsAction(input: { channelSecret: string; accessToken: string }): Promise<LineActionResult> {
  const session = await requireCompanyAdmin();
  const channelSecret = input.channelSecret.trim();
  const accessToken = input.accessToken.trim();
  if (channelSecret && !/^[0-9a-f]{32}$/i.test(channelSecret)) return { error: "Channel secret 格式不對（應該是 32 個英數字）。" };
  if (accessToken && accessToken.length < 50) return { error: "Channel access token 看起來不完整，請到 LINE Developers 重新複製。" };
  if (!channelSecret && !accessToken) return { error: "沒有輸入要更新的金鑰。" };
  await saveLineCredentials(session.companyId, { channelSecret, accessToken });
  revalidatePath(PATH);
  return { success: "已儲存。" };
}

export async function unbindLineGroupAction(groupId: string): Promise<LineActionResult> {
  const session = await requireCompanyAdmin();
  await removeLineGroup(session.companyId, groupId);
  revalidatePath(PATH);
  return { success: "已解除綁定，這個群組不會再收到通知。" };
}

// 發一則測試通知到這間公司綁定的所有群組
export async function sendLineTestAction(): Promise<LineActionResult> {
  const session = await requireCompanyAdmin();
  const settings = await getLineSettings(session.companyId);
  if (!isLineConfigured(settings)) return { error: "請先填寫並儲存 Channel secret 與 Channel access token。" };
  if (settings.groups.length === 0) return { error: "還沒有綁定任何群組。" };
  const url = appBaseUrl();
  const r = await notifyCompany(
    session.companyId,
    `【AIBPO 自動優化】這是一則測試通知（${session.displayName} 傳送）。之後任務完成、失敗、暫停或停止時會通知這個群組。${url ? `\n${url}/optimize` : ""}`,
  );
  if (r.errors.length > 0) return { error: `有群組沒有發送成功：${r.errors.join("；")}` };
  return { success: `已發送到 ${r.sent} 個群組。` };
}
