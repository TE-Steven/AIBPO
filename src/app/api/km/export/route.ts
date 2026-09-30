import type { NextRequest } from "next/server";
import { getSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { generateRagPdf } from "@/lib/ragPdf";
import { getPromptConfig } from "@/lib/promptConfigStore";
import { resolveOptions } from "@/lib/promptConfig";
import { buildKnowledgeMarkdown, tallyPathOf } from "@/lib/kmExport";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  // format=pdf 轉出 PDF（沿用 RAG PDF 的排版與中文字型），預設 .md
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "md";
  const ids = idsParam.split(",").filter(Boolean);
  if (ids.length === 0) {
    return new Response("沒有選擇任何 KM 項目", { status: 400 });
  }

  // 匯出格式依公司在 Prompt 管理的設定（frontmatter、分組、題目格式、是否含結構化文件）
  const options = resolveOptions(session.kind === "user" ? await getPromptConfig(session.companyId) : undefined);

  const entries = await prisma.kmEntry.findMany({
    where: { id: { in: ids }, ...roleScope(session), ...(options.exportIncludeDocs ? {} : { kind: "FAQ" }) },
    include: { tally: { include: { parent: { include: { parent: true } } } }, source: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (entries.length === 0) {
    return new Response(
      options.exportIncludeDocs ? "找不到可匯出的 KM 項目" : "找不到可匯出的 KM 項目（Prompt 管理設定為不匯出結構化文件）",
      { status: 404 },
    );
  }

  const markdown = buildKnowledgeMarkdown({
    entries: entries.map((e) => ({
      kind: e.kind,
      question: e.question,
      answer: e.answer,
      tallyPath: tallyPathOf(e.tally),
      sourceTitle: e.source.title,
    })),
    options,
    format,
    exportedAt: new Date(),
  });

  if (format === "pdf") {
    const buffer = await generateRagPdf(markdown, "KM 知識庫匯出");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="km-export-${Date.now()}.pdf"`,
      },
    });
  }

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="km-export-${Date.now()}.md"`,
    },
  });
}
