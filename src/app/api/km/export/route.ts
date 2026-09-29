import type { NextRequest } from "next/server";
import { getSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { generateRagPdf } from "@/lib/ragPdf";
import { getPromptConfig } from "@/lib/promptConfigStore";
import { resolveOptions } from "@/lib/promptConfig";

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

  function tallyPath(entry: (typeof entries)[number]): string {
    if (!entry.tally) return "未分類";
    const chain = [entry.tally.parent?.parent?.name, entry.tally.parent?.name, entry.tally.name].filter(Boolean);
    return chain.join(" > ");
  }

  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key =
      options.exportGroupBy === "tally" ? tallyPath(entry) : options.exportGroupBy === "source" ? entry.source.title : "";
    const arr = groups.get(key) ?? [];
    arr.push(entry);
    groups.set(key, arr);
  }

  // .md 開頭放 frontmatter 給下游程式讀；PDF 是給人看的，改成一行匯出資訊。
  const lines: string[] = [];
  if (format === "md" && options.exportFrontmatter) {
    lines.push("---");
    lines.push(`exported_at: ${new Date().toISOString()}`);
    lines.push(`count: ${entries.length}`);
    lines.push("---");
    lines.push("");
  }
  lines.push("# KM 知識庫匯出");
  lines.push("");
  if (format === "pdf") {
    const exportedAt = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    lines.push(`匯出時間：${exportedAt}　共 ${entries.length} 題`);
    lines.push("");
  }

  // 有分組時：## 分組 → ### 題目；不分組時題目直接用 ##
  const grouped = options.exportGroupBy !== "none";
  const itemHashes = grouped ? "###" : "##";
  let questionNo = 0;
  for (const [group, groupEntries] of groups) {
    if (grouped) {
      lines.push(`## ${group}`);
      lines.push("");
    }
    for (const entry of groupEntries) {
      if (entry.kind === "DOC") {
        // 結構化文件：實體名稱當題目標題，答案裡的 ## 維度 / ### 子維度 跟著往下降，維持整份匯出的階層
        lines.push(`${itemHashes} ${entry.question}`);
        lines.push("");
        lines.push(entry.answer.replace(/^(#{1,4})(?=\s)/gm, `${itemHashes.slice(1)}$1`));
      } else {
        questionNo += 1;
        lines.push(
          options.exportQuestionFormat === "bold"
            ? `**Q：${entry.question}**`
            : options.exportQuestionFormat === "numbered"
              ? `${itemHashes} ${questionNo}. ${entry.question}`
              : `${itemHashes} Q: ${entry.question}`,
        );
        lines.push("");
        lines.push(entry.answer);
      }
      lines.push("");
    }
  }

  const markdown = lines.join("\n");

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
