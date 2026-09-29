import type { NextRequest } from "next/server";
import { getSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { buildSystemPrompt, buildUserContent, parseFaqDrafts, webFetchMaxUses, hasSourceUrls } from "@/lib/kmAnalysis";
import { buildTallyTree, tallyTemplates, tallyPathOptions, resolveTallyId } from "@/lib/tallyTree";
import { generateTallyDocuments, saveTallyDocuments } from "@/lib/tallyDocuments";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { companyIdForRole } from "@/lib/company";

export const dynamic = "force-dynamic";

const STOPPED_MESSAGE = "這次分析已經被停止，結果沒有保存。";

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
  // FAQ 歸類用完整路徑（同名分類靠路徑區分）；有子分類的第一層分類另外當結構化文件的範本
  const tallyOptions = tallyPathOptions(tallies);
  const templates = tallyTemplates(buildTallyTree(tallies));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // 使用者關掉頁面：停止推送，但分析照樣跑完、結果照樣寫進 DB
          closed = true;
        }
      }

      // 用開始時間標記「這一次」分析：中途按了停止（或重新分析）之後，這次晚到的結果就不寫回
      const startedAt = new Date();
      const sameAttempt = { id, analysisStartedAt: startedAt };
      const stillCurrent = async () => (await prisma.kmSource.count({ where: sameAttempt })) > 0;

      try {
        await prisma.kmSource.update({
          where: { id },
          data: { status: "PROCESSING", errorMessage: null, analysisStartedAt: startedAt },
        });
        send("status", { status: "PROCESSING" });

        const companyId = await companyIdForRole(source.roleId);
        const guidelines = await getSystemSetting(companyId, KM_OUTPUT_GUIDELINES_KEY);

        // ---- 第一段：FAQ ----
        const apiStream = anthropic.messages.stream({
          model: KM_ANALYSIS_MODEL,
          max_tokens: 16000,
          thinking: { type: "adaptive", display: "summarized" },
          system: buildSystemPrompt({
            dimensions,
            tallyPaths: tallyOptions.map((o) => o.path),
            countMin,
            countMax,
            answerStyle,
            guidelines,
          }),
          ...(hasSourceUrls(source)
            ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: webFetchMaxUses(source) }] }
            : {}),
          messages: [{ role: "user", content: buildUserContent(source) }],
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

        if (finalMessage.stop_reason === "max_tokens") {
          throw new Error("FAQ 內容太長，輸出被截斷。請調低 FAQ 題數，或把來源拆成幾份較小的文件後再試。");
        }
        const faqDrafts = parseFaqDrafts(fullText);
        if (faqDrafts.length === 0) {
          throw new Error("AI 沒有產生出可解析的 FAQ，請重試一次，或調整維度後再試。");
        }
        if (!(await stillCurrent())) throw new Error(STOPPED_MESSAGE);

        await prisma.kmEntry.createMany({
          data: faqDrafts.map((f) => ({
            sourceId: id,
            question: f.question,
            answer: f.answer,
            tallyId: resolveTallyId(tallyOptions, f.suggestedTally),
            dimensionsUsed: dimensions,
            roleId: source.roleId,
          })),
        });

        // ---- 第二段：結構化文件（失敗不影響已經存好的 FAQ，之後可以在來源頁「重新產生結構化文件」）----
        let docCount = 0;
        let docError: string | null = null;
        if (templates.length > 0) {
          send("documents", {});
          try {
            const documents = await generateTallyDocuments({
              source,
              templates,
              guidelines,
              onThinking: (text) => send("thinking", { text }),
              onFetch: () => send("stage", { label: "正在讀取網頁內容…" }),
            });
            if (documents.length > 0 && (await stillCurrent())) {
              await saveTallyDocuments({ sourceId: id, roleId: source.roleId, documents, replace: false });
              docCount = documents.length;
            }
          } catch (err) {
            docError = err instanceof Error ? err.message : "結構化文件產生失敗。";
          }
        }

        // 結構化文件失敗的原因留在 errorMessage（狀態仍是 DONE），來源頁的結構化文件卡片會顯示
        await prisma.kmSource.updateMany({
          where: sameAttempt,
          data: { status: "DONE", analysisStartedAt: null, errorMessage: docError ? `結構化文件沒有產生成功：${docError}` : null },
        });
        send("done", { count: faqDrafts.length, docCount, docError });
      } catch (err) {
        const message = err instanceof Error ? err.message : "分析失敗，發生未知錯誤。";
        await prisma.kmSource.updateMany({
          where: sameAttempt,
          data: { status: "FAILED", errorMessage: message, analysisStartedAt: null },
        });
        send("error", { message });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
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
