import type { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { buildAgentTools, executeSkill } from "@/lib/agentTools";

export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_TOOL_ITERATIONS = 6;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { agentSkills: { include: { skill: true } } },
  });
  if (!agent) return new Response("Not found", { status: 404 });
  if (session.kind !== "superadmin" && agent.roleId !== session.roleId) {
    return new Response("Forbidden", { status: 403 });
  }

  const body = (await req.json()) as { messages: ChatMessage[] };
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (history.length === 0) return new Response("empty messages", { status: 400 });

  let messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  const skills = agent.agentSkills.map((as) => as.skill);
  const skillsById = new Map(skills.map((s) => [s.id, s]));
  const tools = buildAgentTools(skills);
  const roleId = agent.roleId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
          const apiStream = anthropic.messages.stream({
            model: KM_ANALYSIS_MODEL,
            max_tokens: 4096,
            thinking: { type: "adaptive" },
            system: agent.systemPrompt,
            tools,
            messages,
          });

          for await (const event of apiStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send("text", { text: event.delta.text });
            }
          }

          const message = await apiStream.finalMessage();
          await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "agent_chat", usage: message.usage, roleId });

          if (message.stop_reason === "pause_turn") {
            messages = [...messages, { role: "assistant", content: message.content }];
            continue;
          }

          if (message.stop_reason !== "tool_use") {
            break;
          }

          messages = [...messages, { role: "assistant", content: message.content }];

          const toolUseBlocks = message.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of toolUseBlocks) {
            const skill = skillsById.get(block.name);
            send("tool_start", { skillId: block.name, skillName: skill?.name ?? null });

            const result = skill
              ? await executeSkill(skill, block.input as Record<string, unknown>)
              : { error: `找不到對應的 Skill（id: ${block.name}）。` };

            send("tool_end", { skillId: block.name, success: !(result && typeof result === "object" && "error" in result) });
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
          }

          messages = [...messages, { role: "user", content: toolResults }];
        }

        send("done", {});
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "未知錯誤" });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
