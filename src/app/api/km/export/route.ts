import type { NextRequest } from "next/server";
import { getSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const idsParam = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").filter(Boolean);
  if (ids.length === 0) {
    return new Response("沒有選擇任何 KM 項目", { status: 400 });
  }

  const entries = await prisma.kmEntry.findMany({
    where: { id: { in: ids }, ...roleScope(session) },
    include: { tally: { include: { parent: { include: { parent: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  if (entries.length === 0) {
    return new Response("找不到可匯出的 KM 項目", { status: 404 });
  }

  function tallyPath(entry: (typeof entries)[number]): string {
    if (!entry.tally) return "未分類";
    const chain = [entry.tally.parent?.parent?.name, entry.tally.parent?.name, entry.tally.name].filter(Boolean);
    return chain.join(" > ");
  }

  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = tallyPath(entry);
    const arr = groups.get(key) ?? [];
    arr.push(entry);
    groups.set(key, arr);
  }

  const lines: string[] = [];
  lines.push("---");
  lines.push(`exported_at: ${new Date().toISOString()}`);
  lines.push(`count: ${entries.length}`);
  lines.push("---");
  lines.push("");
  lines.push("# KM 知識庫匯出");
  lines.push("");

  for (const [group, groupEntries] of groups) {
    lines.push(`## ${group}`);
    lines.push("");
    for (const entry of groupEntries) {
      lines.push(`### Q: ${entry.question}`);
      lines.push("");
      lines.push(entry.answer);
      lines.push("");
    }
  }

  const markdown = lines.join("\n");

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="km-export-${Date.now()}.md"`,
    },
  });
}
