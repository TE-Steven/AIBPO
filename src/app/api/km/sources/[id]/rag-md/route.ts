import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) return new Response("Not found", { status: 404 });
  if (session.kind !== "superadmin" && source.roleId !== session.roleId) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!source.ragContent) {
    return new Response("這份來源還沒有產生 RAG 內容", { status: 400 });
  }

  const safeTitle = source.title.replace(/[\\/:*?"<>|]/g, "_") || "rag-content";
  const encodedTitle = encodeURIComponent(`${safeTitle}.md`);

  return new Response(source.ragContent, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // 檔名可能含中文，Content-Disposition 的 filename 只能是 ASCII，中文檔名要用 RFC 5987 的 filename* 表示。
      "Content-Disposition": `attachment; filename="rag-content.md"; filename*=UTF-8''${encodedTitle}`,
    },
  });
}
