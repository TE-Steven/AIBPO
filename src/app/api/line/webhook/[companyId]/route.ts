import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  addLineGroup,
  getLineSettings,
  isLineConfigured,
  lineBindingCode,
  lineGroupName,
  lineReply,
  removeLineGroup,
  verifyLineSignature,
} from "@/lib/lineNotify";

export const dynamic = "force-dynamic";

// 公司 LINE 機器人的 webhook（在 LINE Developers 設成「參數管理 → LINE 通知」顯示的網址）。
// 這個路徑不經過登入檢查（proxy 排除），用這間公司的 channel secret 驗證簽章：
// - 被拉進群組：回覆綁定說明
// - 群組裡傳這間公司的綁定碼：綁定群組
// - 群組裡傳「解除綁定」或機器人被踢出群組：解除

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type: string; groupId?: string; roomId?: string };
  message?: { type: string; text?: string };
};

const HELP =
  "你好，我是 AIBPO 通知機器人。\n請公司管理員到 AIBPO「參數管理 → LINE 通知」複製綁定碼（AIBPO- 開頭），貼到這個群組，之後自動優化完成、失敗或暫停時就會通知這裡。\n要停止通知，在群組傳「解除綁定」。";

export async function POST(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const settings = await getLineSettings(companyId);
  if (!isLineConfigured(settings)) return new Response("LINE not configured", { status: 404 });
  const body = await req.text();
  if (!verifyLineSignature(settings.channelSecret, body, req.headers.get("x-line-signature"))) {
    return new Response("Bad signature", { status: 401 });
  }
  const token = settings.accessToken;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  const code = lineBindingCode(companyId);

  async function handle(event: LineEvent) {
    const chatId = event.source?.groupId ?? event.source?.roomId ?? null;
    const reply = (text: string) => (event.replyToken ? lineReply(token, event.replyToken, text) : Promise.resolve());

    if (event.type === "join") return reply(HELP);
    if (event.type === "leave") {
      if (chatId) await removeLineGroup(companyId, chatId);
      return;
    }
    if (event.type !== "message" || event.message?.type !== "text") return;
    const text = (event.message.text ?? "").trim();

    if (!chatId) {
      if (/AIBPO-|綁定|通知/i.test(text)) await reply("通知只會發到群組：請把我拉進要接收通知的 LINE 群組，再在群組裡傳綁定碼。");
      return;
    }
    if (/^解除綁定$|^取消通知$/.test(text)) {
      const removed = await removeLineGroup(companyId, chatId);
      return reply(removed ? "已解除綁定，這個群組不會再收到 AIBPO 通知。" : "這個群組目前沒有綁定。");
    }
    const sent = text.toUpperCase().match(/AIBPO-[A-Z0-9]{6}/)?.[0];
    if (!sent) return; // 群組裡的一般對話不回應
    if (sent !== code) return reply("綁定碼不正確，請到 AIBPO「參數管理 → LINE 通知」重新複製。");
    await addLineGroup(companyId, chatId, event.source?.groupId ? await lineGroupName(token, chatId) : null);
    return reply(`已綁定「${company?.name ?? "AIBPO"}」。之後自動優化完成、失敗、暫停等 token 或被停止時，會通知這個群組。\n要停止通知，傳「解除綁定」。`);
  }

  const { events = [] } = JSON.parse(body) as { events?: LineEvent[] };
  // LINE 後台的「驗證 webhook」會送空的 events，直接回 200
  await Promise.all(events.map((e) => handle(e).catch((err) => console.error("LINE webhook event failed", err))));
  return new Response("OK");
}
