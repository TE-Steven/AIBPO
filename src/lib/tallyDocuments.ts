import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import {
  buildDocumentsSystemPrompt,
  buildUserContent,
  parseTallyOutput,
  buildTallyDocumentMarkdown,
  entityKey,
  entityNameKey,
  webFetchMaxUses,
  hasSourceUrls,
  type TallyTemplate,
  type TallyOutputDraft,
} from "@/lib/kmAnalysis";
import type { KmSource } from "@/generated/prisma/client";

// 依分類範本產生結構化文件（KmEntry kind = DOC）。跟 FAQ 分開呼叫：一起輸出時太長容易被截斷，而且一邊失敗會連另一邊都拿不到。

export type GeneratedDocument = { templateId: string; name: string; answer: string };

export async function generateTallyDocuments(params: {
  source: KmSource;
  templates: TallyTemplate[];
  guidelines: string;
  onThinking?: (text: string) => void;
  onFetch?: () => void;
}): Promise<GeneratedDocument[]> {
  const { source, templates } = params;

  const apiStream = anthropic.messages.stream({
    model: KM_ANALYSIS_MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive", display: "summarized" },
    system: buildDocumentsSystemPrompt({ templates, guidelines: params.guidelines }),
    ...(hasSourceUrls(source)
      ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: webFetchMaxUses(source) }] }
      : {}),
    messages: [{ role: "user", content: buildUserContent(source, "documents") }],
  });

  let fullText = "";
  for await (const event of apiStream) {
    if (event.type === "content_block_delta") {
      if (event.delta.type === "thinking_delta") params.onThinking?.(event.delta.thinking);
      else if (event.delta.type === "text_delta") fullText += event.delta.text;
    } else if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
      params.onFetch?.();
    }
  }

  const finalMessage = await apiStream.finalMessage();
  await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "km_documents", usage: finalMessage.usage, roleId: source.roleId });

  if (finalMessage.stop_reason === "max_tokens") {
    throw new Error("結構化文件內容太長，輸出被截斷。請減少範本的維度，或把來源拆成幾份較小的文件後再試。");
  }

  return assembleTallyDocuments(parseTallyOutput(fullText), templates);
}

// AI 輸出 → 每個實體一份 markdown：去重、雙向寫入關聯、附上通用規則（純函式，方便測試）
export function assembleTallyDocuments(output: TallyOutputDraft, templates: TallyTemplate[]): GeneratedDocument[] {
  const templateByName = new Map(templates.map((t) => [t.name, t]));
  const seen = new Set<string>();
  const drafts = output.documents.filter((d) => {
    const key = entityKey(d.template, d.name);
    if (!templateByName.has(d.template) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 關聯雙向寫入：每一筆關聯寫進每個相關實體的「相關項目」，列出其他實體；名稱比對忽略大小寫、全半形、空白與連字號
  const seenRelations = new Set<string>();
  const relations = output.relations.filter((r) => {
    const key = `${[...r.items.map(entityNameKey)].sort().join("|")}\u0000${r.description}`;
    if (seenRelations.has(key)) return false;
    seenRelations.add(key);
    return true;
  });
  // 關聯裡的名稱如果對得上某份文件，就顯示那份文件的正式名稱（AI 可能寫成「L-700」，文件叫「L700」）
  const canonicalName = new Map<string, string>();
  for (const d of drafts) if (!canonicalName.has(entityNameKey(d.name))) canonicalName.set(entityNameKey(d.name), d.name);
  function relatedFor(name: string) {
    const self = entityNameKey(name);
    return relations
      .filter((r) => r.items.some((item) => entityNameKey(item) === self))
      .map((r) => ({
        others: r.items
          .filter((item) => entityNameKey(item) !== self)
          .map((item) => canonicalName.get(entityNameKey(item)) ?? item),
        description: r.description,
      }))
      .filter((r) => r.others.length > 0);
  }

  return drafts.map((d) => {
    const template = templateByName.get(d.template)!;
    return {
      templateId: template.id,
      name: d.name,
      answer: buildTallyDocumentMarkdown(template, d.values, {
        related: relatedFor(d.name),
        sharedRules: output.sharedRules.get(template.name) ?? [],
      }),
    };
  });
}

// 寫入結構化文件；replace = true 時先刪掉這個來源既有的結構化文件（重新產生用），同一個 transaction，失敗就兩邊都不動。
export async function saveTallyDocuments(params: {
  sourceId: string;
  roleId: string;
  documents: GeneratedDocument[];
  replace: boolean;
}): Promise<void> {
  await prisma.$transaction([
    ...(params.replace ? [prisma.kmEntry.deleteMany({ where: { sourceId: params.sourceId, kind: "DOC" } })] : []),
    prisma.kmEntry.createMany({
      data: params.documents.map((d) => ({
        sourceId: params.sourceId,
        kind: "DOC",
        question: d.name,
        answer: d.answer,
        tallyId: d.templateId,
        roleId: params.roleId,
      })),
    }),
  ]);
}
