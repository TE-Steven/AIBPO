import type { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { buildSkillDraftSystemPrompt } from "@/lib/skillChat";

export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as { messages: ChatMessage[] };
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (history.length === 0) return new Response("empty messages", { status: 400 });

  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const roleId = session.kind === "superadmin" ? null : session.roleId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const apiStream = anthropic.messages.stream({
          model: KM_ANALYSIS_MODEL,
          max_tokens: 2048,
          thinking: { type: "adaptive" },
          system: buildSkillDraftSystemPrompt(),
          messages,
        });

        for await (const event of apiStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        const message = await apiStream.finalMessage();
        await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "skill_draft_chat", usage: message.usage, roleId });
      } catch (err) {
        controller.enqueue(encoder.encode(`\n\n[錯誤：${err instanceof Error ? err.message : "未知錯誤"}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
