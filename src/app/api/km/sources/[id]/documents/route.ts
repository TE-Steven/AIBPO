import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildTallyTree, tallyTemplates } from "@/lib/tallyTree";
import { generateTallyDocuments, saveTallyDocuments } from "@/lib/tallyDocuments";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";
import { companyIdForRole } from "@/lib/company";
import { getPromptConfig } from "@/lib/promptConfigStore";

export const dynamic = "force-dynamic";

// 重新產生結構化文件：分析完成後改了分類範本，或第一次產生失敗時使用。
// 新的產生成功才替換掉這個來源既有的結構化文件；失敗的話舊的保持不動。FAQ 完全不受影響。
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.kind !== "user") return new Response("Forbidden", { status: 403 });

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) return new Response("Not found", { status: 404 });
  if (source.roleId !== session.roleId) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      // 用開始時間標記「這一次」產生：按了停止之後，這次晚到的結果不寫入
      const docStartedAt = new Date();
      const sameDocAttempt = { id, docStartedAt };
      let started = false;
      try {
        if (source.status !== "DONE") throw new Error("這個來源還沒分析完成，請先完成分析。");
        const tallies = await prisma.tally.findMany({ where: { roleId: source.roleId }, orderBy: { order: "asc" } });
        const templates = tallyTemplates(buildTallyTree(tallies));
        if (templates.length === 0) {
          throw new Error("目前沒有文件範本：請先到「分類管理」在大分類底下加上子分類（維度）。");
        }

        await prisma.kmSource.update({ where: { id }, data: { docStatus: "PROCESSING", docErrorMessage: null, docStartedAt } });
        started = true;

        const companyId = await companyIdForRole(source.roleId);
        const [guidelines, promptConfig] = await Promise.all([
          getSystemSetting(companyId, KM_OUTPUT_GUIDELINES_KEY),
          getPromptConfig(companyId),
        ]);
        const documents = await generateTallyDocuments({
          source,
          templates,
          guidelines,
          config: promptConfig,
          onThinking: (text) => send("thinking", { text }),
          onFetch: () => send("stage", { label: "正在讀取網頁內容…" }),
        });
        if (documents.length === 0) {
          throw new Error("文件裡沒有找到符合範本的實體，既有的結構化文件保持不變。");
        }

        if ((await prisma.kmSource.count({ where: sameDocAttempt })) === 0) {
          throw new Error("這次產生已經被停止，結果沒有保存。");
        }
        await saveTallyDocuments({ sourceId: id, roleId: source.roleId, documents, replace: true });
        await prisma.kmSource.updateMany({ where: sameDocAttempt, data: { docStatus: "DONE", docStartedAt: null } });
        send("done", { docCount: documents.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : "結構化文件產生失敗。";
        if (started) {
          // 失敗時舊文件保持不動：有舊文件就維持「已完成」，只記錄這次的錯誤
          const hasDocs = (await prisma.kmEntry.count({ where: { sourceId: id, kind: "DOC" } })) > 0;
          await prisma.kmSource.updateMany({
            where: sameDocAttempt,
            data: { docStatus: hasDocs ? "DONE" : "FAILED", docErrorMessage: message, docStartedAt: null },
          });
        }
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
