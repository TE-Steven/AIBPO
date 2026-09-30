import type { PromptOptions } from "@/lib/promptConfig";

// 知識列表匯出與知識庫版本共用的 markdown 組法（純函式）。
// 格式依公司在 Prompt 管理的設定：frontmatter、分組、FAQ 題目格式（是否含結構化文件由呼叫端先篩選）。

export type ExportEntry = {
  kind: string; // FAQ / DOC
  question: string;
  answer: string;
  tallyPath: string; // 分類完整路徑，沒分類為「未分類」
  sourceTitle: string;
};

type ExportOptions = Pick<PromptOptions, "exportFrontmatter" | "exportGroupBy" | "exportQuestionFormat">;

export function tallyPathOf(tally: { name: string; parent?: { name: string; parent?: { name: string } | null } | null } | null): string {
  if (!tally) return "未分類";
  return [tally.parent?.parent?.name, tally.parent?.name, tally.name].filter(Boolean).join(" > ");
}

export function buildKnowledgeMarkdown(params: {
  entries: ExportEntry[];
  options: ExportOptions;
  format: "md" | "pdf";
  exportedAt: Date;
  title?: string;
}): string {
  const { entries, options, format, exportedAt } = params;

  const groups = new Map<string, ExportEntry[]>();
  for (const entry of entries) {
    const key = options.exportGroupBy === "tally" ? entry.tallyPath : options.exportGroupBy === "source" ? entry.sourceTitle : "";
    const arr = groups.get(key) ?? [];
    arr.push(entry);
    groups.set(key, arr);
  }

  // .md 開頭放 frontmatter 給下游程式讀；PDF 是給人看的，改成一行匯出資訊。
  const lines: string[] = [];
  if (format === "md" && options.exportFrontmatter) {
    lines.push("---");
    lines.push(`exported_at: ${exportedAt.toISOString()}`);
    lines.push(`count: ${entries.length}`);
    lines.push("---");
    lines.push("");
  }
  lines.push(`# ${params.title ?? "KM 知識庫匯出"}`);
  lines.push("");
  if (format === "pdf") {
    const at = exportedAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    lines.push(`匯出時間：${at}　共 ${entries.length} 題`);
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

  return lines.join("\n");
}
