import type { NextRequest } from "next/server";
import { getSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { buildSystemPrompt, buildUserContent, parseFaqDrafts, webFetchMaxUses } from "@/lib/kmAnalysis";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) return new Response("Not found", { status: 404 });
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  let dimensions: string[] = [];
  try {
    dimensions = JSON.parse(url.searchParams.get("dimensions") ?? "[]");
  } catch {
    dimensions = [];
  }
  const useTally = url.searchParams.get("useTally") === "1";
  const countMin = Math.max(1, Number(url.searchParams.get("countMin") ?? "10") || 10);
  const countMax = Math.max(countMin, Number(url.searchParams.get("countMax") ?? "30") || 30);
  const answerStyle = url.searchParams.get("answerStyle") ?? "";

  const tallies = useTally ? await prisma.tally.findMany({ where: roleScope(session), orderBy: { order: "asc" } }) : [];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        await prisma.kmSource.update({ where: { id }, data: { status: "PROCESSING", errorMessage: null } });
        send("status", { status: "PROCESSING" });

        const guidelines = await getSystemSetting(KM_OUTPUT_GUIDELINES_KEY);
        const system = buildSystemPrompt({ dimensions, tallies, countMin, countMax, answerStyle, guidelines });
        const content = buildUserContent(source);

        const apiStream = anthropic.messages.stream({
          model: KM_ANALYSIS_MODEL,
          max_tokens: 16000,
          thinking: { type: "adaptive", display: "summarized" },
          system,
          ...(source.sourceType === "URL"
            ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: webFetchMaxUses(source) }] }
            : {}),
          messages: [{ role: "user", content }],
        });

        let fullText = "";
        for await (const event of apiStream) {
          if (event.type === "content_block_delta") {
            if (event.delta.type === "thinking_delta") {
              send("thinking", { text: event.delta.thinking });
            } else if (event.delta.type === "text_delta") {
              fullText += event.delta.text;
              send("text", { text: event.delta.text });
            }
          } else if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
            send("stage", { label: "正在讀取網頁內容…" });
          }
        }

        const finalMessage = await apiStream.finalMessage();
        await recordApiUsage({
          model: KM_ANALYSIS_MODEL,
          purpose: "km_analysis",
          usage: finalMessage.usage,
          roleId: source.roleId,
        });

        const faqDrafts = parseFaqDrafts(fullText);
        if (faqDrafts.length === 0) {
          throw new Error("AI 沒有產生出可解析的 FAQ，請重試一次，或調整維度後再試。");
        }

        const tallyIdByName = new Map(tallies.map((t) => [t.name, t.id]));

        await prisma.$transaction(
          faqDrafts.map((f) =>
            prisma.kmEntry.create({
              data: {
                sourceId: id,
                question: f.question,
                answer: f.answer,
                tallyId: f.suggestedTally ? (tallyIdByName.get(f.suggestedTally) ?? null) : null,
                dimensionsUsed: dimensions,
                roleId: source.roleId,
              },
            }),
          ),
        );

        await prisma.kmSource.update({ where: { id }, data: { status: "DONE" } });
        send("done", { count: faqDrafts.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : "分析失敗，發生未知錯誤。";
        await prisma.kmSource.update({ where: { id }, data: { status: "FAILED", errorMessage: message } });
        send("error", { message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
