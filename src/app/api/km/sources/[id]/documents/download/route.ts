import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildTallyDocumentsMarkdown, documentsFileName } from "@/lib/tallyDocumentsExport";
import { generateRagPdf } from "@/lib/ragPdf";

// 下載整份結構化文件（每個實體一個 H1）。format=pdf 轉 PDF，預設 .md。
async function loadDocumentsMarkdown(id: string): Promise<{ markdown: string; title: string } | Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) return new Response("Not found", { status: 404 });
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) return new Response("Forbidden", { status: 403 });

  const [entries, templates] = await Promise.all([
    prisma.kmEntry.findMany({
      where: { sourceId: id, kind: "DOC" },
      select: { question: true, answer: true, tallyId: true, createdAt: true },
    }),
    prisma.tally.findMany({ where: { roleId: source.roleId, parentId: null }, select: { id: true, order: true, name: true } }),
  ]);
  if (entries.length === 0) return new Response("這份來源還沒有結構化文件", { status: 400 });

  return { markdown: buildTallyDocumentsMarkdown(entries, templates), title: source.title };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadDocumentsMarkdown(id);
  if (loaded instanceof Response) return loaded;

  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "md";
  const name = documentsFileName(loaded.title, format);
  // 檔名可能含中文，Content-Disposition 的 filename 只能是 ASCII，中文檔名要用 RFC 5987 的 filename* 表示。
  const disposition = `attachment; filename="${name.ascii}"; filename*=UTF-8''${name.encoded}`;

  if (format === "pdf") {
    const buffer = await generateRagPdf(loaded.markdown, `${loaded.title} 結構化文件`);
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition },
    });
  }
  return new Response(loaded.markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": disposition },
  });
}
