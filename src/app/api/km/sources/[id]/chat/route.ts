import type { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { buildChatSystemPrompt, buildUserContent } from "@/lib/kmAnalysis";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";

export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) return new Response("Not found", { status: 404 });
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) {
    return new Response("Forbidden", { status: 403 });
  }

  const body = (await req.json()) as { messages: ChatMessage[] };
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (history.length === 0) return new Response("empty messages", { status: 400 });

  const entries = await prisma.kmEntry.findMany({
    where: { sourceId: id },
    select: { question: true, answer: true },
    orderBy: { createdAt: "asc" },
  });

  const guidelines = await getSystemSetting(KM_OUTPUT_GUIDELINES_KEY);
  const system = buildChatSystemPrompt(entries, guidelines);

  // 第一則使用者訊息前面帶上原始文件/網址內容；後續輪次只需要純文字對話，不用每次都重附文件內容，
  // 因為同一個 API 請求裡已經包含了完整歷史，Claude 一次就能看到最前面附的文件。
  const messages: Anthropic.MessageParam[] = history.map((m, i) => {
    if (i === 0 && m.role === "user") {
      const sourceContent = buildUserContent(source);
      const contentArray = Array.isArray(sourceContent) ? sourceContent : [{ type: "text" as const, text: String(sourceContent) }];
      return { role: "user", content: [...contentArray, { type: "text", text: m.content }] };
    }
    return { role: m.role, content: m.content };
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const apiStream = anthropic.messages.stream({
          model: KM_ANALYSIS_MODEL,
          max_tokens: 4096,
          thinking: { type: "adaptive" },
          system,
          ...(source.sourceType === "URL"
            ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: 2 }] }
            : {}),
          messages,
        });

        for await (const event of apiStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        const finalMessage = await apiStream.finalMessage();
        await recordApiUsage({
          model: KM_ANALYSIS_MODEL,
          purpose: "km_chat",
          usage: finalMessage.usage,
          roleId: source.roleId,
        });
      } catch (err) {
        controller.enqueue(encoder.encode(`\n\n[錯誤：${err instanceof Error ? err.message : "未知錯誤"}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
