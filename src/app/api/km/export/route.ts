import type { NextRequest } from "next/server";
import { getSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { generateRagPdf } from "@/lib/ragPdf";
import { getPromptConfig } from "@/lib/promptConfigStore";
import { resolveOptions } from "@/lib/promptConfig";
import { buildKnowledgeMarkdown, tallyPathOf, type ExportEntry } from "@/lib/kmExport";
import ExcelJS from "exceljs";

// Excel 匯出：FAQ 一個工作表（題目／答案／分類／來源），有結構化文件時另一個工作表
async function buildKnowledgeXlsx(entries: ExportEntry[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const addSheet = (name: string, headers: [string, number][], rows: string[][]) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = headers.map(([header, width]) => ({ header, width }));
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row);
    sheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  };
  const faqs = entries.filter((e) => e.kind !== "DOC");
  const docs = entries.filter((e) => e.kind === "DOC");
  addSheet(
    "FAQ",
    [["題目", 45], ["答案", 80], ["分類", 30], ["來源", 30]],
    faqs.map((e) => [e.question, e.answer, e.tallyPath, e.sourceTitle]),
  );
  if (docs.length > 0) {
    addSheet(
      "結構化文件",
      [["項目", 30], ["內容", 100], ["分類", 30], ["來源", 30]],
      docs.map((e) => [e.question, e.answer, e.tallyPath, e.sourceTitle]),
    );
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  // format=pdf 轉出 PDF（沿用 RAG PDF 的排版與中文字型）、format=xlsx 轉出 Excel，預設 .md
  const formatParam = url.searchParams.get("format");
  const format = formatParam === "pdf" ? "pdf" : formatParam === "xlsx" ? "xlsx" : "md";
  const ids = idsParam.split(",").filter(Boolean);
  if (ids.length === 0) {
    return new Response("沒有選擇任何 KM 項目", { status: 400 });
  }

  // 匯出格式依公司在 參數管理的設定（frontmatter、分組、題目格式、是否含結構化文件）
  const options = resolveOptions(session.kind === "user" ? await getPromptConfig(session.companyId) : undefined);

  const entries = await prisma.kmEntry.findMany({
    where: { id: { in: ids }, ...roleScope(session), ...(options.exportIncludeDocs ? {} : { kind: "FAQ" }) },
    include: { tally: { include: { parent: { include: { parent: true } } } }, source: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (entries.length === 0) {
    return new Response(
      options.exportIncludeDocs ? "找不到可匯出的 KM 項目" : "找不到可匯出的 KM 項目（參數管理設定為不匯出結構化文件）",
      { status: 404 },
    );
  }

  const exportEntries: ExportEntry[] = entries.map((e) => ({
    kind: e.kind,
    question: e.question,
    answer: e.answer,
    tallyPath: tallyPathOf(e.tally),
    sourceTitle: e.source.title,
  }));

  if (format === "xlsx") {
    const buffer = await buildKnowledgeXlsx(exportEntries);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="km-export-${Date.now()}.xlsx"`,
      },
    });
  }

  const markdown = buildKnowledgeMarkdown({
    entries: exportEntries,
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
