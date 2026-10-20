import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { generateRagPdf } from "@/lib/ragPdf";
import { buildKnowledgeMarkdown, type ExportEntry } from "@/lib/kmExport";
import { resolveOptions, type PromptConfigData } from "@/lib/promptConfig";
import { buildFaqWorkbook, cleanFaqItems } from "@/lib/faqKnowledge";

// 下載知識庫版本：.md 用建立當下凍結的全文；PDF 用凍結的題目快照重新排版（格式跟建立當時的設定一致）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const version = await prisma.kbVersion.findUnique({ where: { id } });
  if (!version) return new Response("Not found", { status: 404 });
  if (session.kind !== "superadmin" && version.roleId !== session.roleId) return new Response("Forbidden", { status: 403 });

  const requested = new URL(req.url).searchParams.get("format");
  // FAQ優化的版本可以下載匯入 FAQ 知識庫用的 Excel（格式照官方範本）
  if (requested === "xlsx") {
    const items = cleanFaqItems(version.faqItems);
    if (items.length === 0) return new Response("這個版本不是 FAQ優化的版本，沒有 FAQ Excel。", { status: 404 });
    const name = encodeURIComponent(`FAQ匯入-${version.name.replace(/[\\/:*?"<>|]/g, "_")}.xlsx`);
    return new Response(new Uint8Array(await buildFaqWorkbook(items)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="faq-import.xlsx"; filename*=UTF-8''${name}`,
      },
    });
  }
  const format = requested === "pdf" ? "pdf" : "md";
  const fileBase = encodeURIComponent(`KM知識庫-${version.name.replace(/[\\/:*?"<>|]/g, "_")}.${format}`);
  // 檔名可能含中文，Content-Disposition 的 filename 只能是 ASCII，中文檔名要用 RFC 5987 的 filename* 表示。
  const disposition = `attachment; filename="km-version.${format}"; filename*=UTF-8''${fileBase}`;

  if (format === "pdf") {
    const settings = (version.settings ?? {}) as { promptConfig?: PromptConfigData };
    // 自動優化的版本是 AI 改過的整份 md，跟題目快照不同，PDF 直接用凍結的全文排版
    const markdown = version.jobId
      ? version.markdown
      : buildKnowledgeMarkdown({
          entries: version.entries as unknown as ExportEntry[],
          options: resolveOptions(settings.promptConfig),
          format: "pdf",
          exportedAt: version.createdAt,
          title: `KM 知識庫 ${version.name}`,
        });
    const buffer = await generateRagPdf(markdown, `KM 知識庫 ${version.name}`);
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition } });
  }

  return new Response(version.markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": disposition },
  });
}
