import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import {
  buildDocumentsSystemPrompt,
  buildUserContent,
  parseTallyDocuments,
  buildTallyDocumentMarkdown,
  entityKey,
  webFetchMaxUses,
  hasSourceUrls,
  type TallyTemplate,
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

  const templateByName = new Map(templates.map((t) => [t.name, t]));
  const seen = new Set<string>();
  const documents = parseTallyDocuments(fullText).flatMap((d) => {
    const template = templateByName.get(d.template);
    const key = entityKey(d.template, d.name);
    if (!template || seen.has(key)) return [];
    seen.add(key);
    return [{ templateId: template.id, name: d.name, answer: buildTallyDocumentMarkdown(template, d.values) }];
  });
  return documents;
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
