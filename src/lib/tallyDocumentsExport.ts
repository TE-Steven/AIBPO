// 把一個來源的所有結構化文件組成「整份」markdown：每個實體一個 H1，底下是原本的 ## 維度 / ### 子維度。
// 排序：先依範本（第一層分類）在分類管理的順序，同一範本內依建立時間。純函式，.md 與 PDF 下載共用。

type DocEntry = { question: string; answer: string; tallyId: string | null; createdAt: Date };
type TemplateOrder = { id: string; order: number; name: string };

// selfContainedHeadings：維度標題前面加上項目名稱（「## L600｜價格」），下游 RAG 切塊後仍看得出是哪個項目（RAG 規則 R5／R12）
export function buildTallyDocumentsMarkdown(
  entries: DocEntry[],
  templates: TemplateOrder[],
  selfContainedHeadings = true,
): string {
  const rank = new Map(
    [...templates].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map((t, i) => [t.id, i]),
  );
  const sorted = [...entries].sort((a, b) => {
    const ra = a.tallyId ? (rank.get(a.tallyId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const rb = b.tallyId ? (rank.get(b.tallyId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    return ra - rb || a.createdAt.getTime() - b.createdAt.getTime();
  });
  return sorted
    .map((e) => {
      const body = e.answer.trim();
      return `# ${e.question}\n\n${selfContainedHeadings ? body.replace(/^(#{2,6})\s+(.+)$/gm, `$1 ${e.question}｜$2`) : body}`;
    })
    .join("\n\n");
}

export function documentsFileName(sourceTitle: string, ext: "md" | "pdf"): { ascii: string; encoded: string } {
  const safeTitle = sourceTitle.replace(/[\\/:*?"<>|]/g, "_") || "structured-documents";
  return { ascii: `structured-documents.${ext}`, encoded: encodeURIComponent(`${safeTitle}-結構化文件.${ext}`) };
}
