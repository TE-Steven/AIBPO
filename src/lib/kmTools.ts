import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { anthropic, KM_ANALYSIS_MODEL, recordApiUsage } from "@/lib/anthropic";
import { buildSystemPrompt, buildUserContent, parseFaqDrafts, webFetchMaxUses, hasSourceUrls } from "@/lib/kmAnalysis";
import { getSystemSetting, KM_OUTPUT_GUIDELINES_KEY } from "@/lib/systemSettings";

type Field = "question" | "answer" | "both";

function matches(text: string, needle: string) {
  return text.includes(needle);
}

function isMatch(entry: { question: string; answer: string }, matchText: string, field: Field) {
  if (field !== "answer" && matches(entry.question, matchText)) return true;
  if (field !== "question" && matches(entry.answer, matchText)) return true;
  return false;
}

export const KM_TOOLS: Anthropic.Tool[] = [
  {
    name: "find_replace_in_entries",
    description: "在這份來源已產出的所有 KM 題目/答案文字中，尋找符合的字串並整段取代成新的字串。",
    input_schema: {
      type: "object",
      properties: {
        find: { type: "string", description: "要尋找的文字" },
        replace: { type: "string", description: "取代成的文字" },
        field: { type: "string", enum: ["question", "answer", "both"], description: "要在題目、答案、還是兩者都找" },
      },
      required: ["find", "replace", "field"],
    },
  },
  {
    name: "generate_more_entries",
    description: "針對這份來源重新讀取內容，額外產生更多 KM 題目與答案，會加進現有清單，不會覆蓋或刪除既有的題目。",
    input_schema: {
      type: "object",
      properties: {
        dimensions: { type: "array", items: { type: "string" }, description: "這次額外分析要關注的維度" },
        count: { type: "integer", description: "希望額外產生的題數" },
      },
      required: ["dimensions", "count"],
    },
  },
  {
    name: "reclassify_entries",
    description: "把符合條件的 KM 題目，改歸類到指定的 Tally 分類（分類必須已經存在）。",
    input_schema: {
      type: "object",
      properties: {
        matchText: { type: "string", description: "用來篩選題目的文字" },
        matchField: { type: "string", enum: ["question", "answer", "both"] },
        tallyName: { type: "string", description: "要歸類到的分類名稱，必須是現有分類清單裡的名稱" },
      },
      required: ["matchText", "matchField", "tallyName"],
    },
  },
  {
    name: "delete_entries",
    description: "刪除符合條件的 KM 題目。這是刪除操作，篩選文字必須夠明確，太短或空字串會被拒絕執行。",
    input_schema: {
      type: "object",
      properties: {
        matchText: { type: "string", description: "用來篩選要刪除題目的文字，至少要有意義的關鍵字" },
        matchField: { type: "string", enum: ["question", "answer", "both"] },
      },
      required: ["matchText", "matchField"],
    },
  },
];

export async function executeKmTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: { sourceId: string; roleId: string },
): Promise<unknown> {
  switch (toolName) {
    case "find_replace_in_entries":
      return findReplaceInEntries(ctx.sourceId, input as { find: string; replace: string; field: Field });
    case "generate_more_entries":
      return generateMoreEntries(ctx.sourceId, ctx.roleId, input as { dimensions: string[]; count: number });
    case "reclassify_entries":
      return reclassifyEntries(ctx.sourceId, ctx.roleId, input as { matchText: string; matchField: Field; tallyName: string });
    case "delete_entries":
      return deleteEntries(ctx.sourceId, input as { matchText: string; matchField: Field });
    default:
      return { error: `未知的工具：${toolName}` };
  }
}

async function findReplaceInEntries(sourceId: string, input: { find: string; replace: string; field: Field }) {
  if (!input.find) return { error: "find 不能是空字串。" };

  const entries = await prisma.kmEntry.findMany({ where: { sourceId } });
  const matched = entries.filter((e) => isMatch(e, input.find, input.field));

  for (const e of matched) {
    const data: { question?: string; answer?: string } = {};
    if (input.field !== "answer" && e.question.includes(input.find)) {
      data.question = e.question.split(input.find).join(input.replace);
    }
    if (input.field !== "question" && e.answer.includes(input.find)) {
      data.answer = e.answer.split(input.find).join(input.replace);
    }
    if (Object.keys(data).length > 0) {
      await prisma.kmEntry.update({ where: { id: e.id }, data });
    }
  }

  return { count: matched.length, affectedQuestions: matched.map((e) => e.question) };
}

async function reclassifyEntries(
  sourceId: string,
  roleId: string,
  input: { matchText: string; matchField: Field; tallyName: string },
) {
  if (!input.matchText) return { error: "matchText 不能是空字串。" };

  const tally = await prisma.tally.findFirst({ where: { roleId, name: input.tallyName } });
  if (!tally) {
    return { error: `找不到名為「${input.tallyName}」的分類，請先到分類管理建立這個分類。` };
  }

  const entries = await prisma.kmEntry.findMany({ where: { sourceId } });
  const matched = entries.filter((e) => isMatch(e, input.matchText, input.matchField));

  await prisma.kmEntry.updateMany({
    where: { id: { in: matched.map((e) => e.id) } },
    data: { tallyId: tally.id },
  });

  return { count: matched.length, affectedQuestions: matched.map((e) => e.question) };
}

async function deleteEntries(sourceId: string, input: { matchText: string; matchField: Field }) {
  if (!input.matchText || input.matchText.trim().length < 2) {
    return { error: "篩選文字太短或是空的，為了安全不會執行刪除，請提供更明確的關鍵字。" };
  }

  const entries = await prisma.kmEntry.findMany({ where: { sourceId } });
  const matched = entries.filter((e) => isMatch(e, input.matchText, input.matchField));

  await prisma.kmEntry.deleteMany({ where: { id: { in: matched.map((e) => e.id) } } });

  return { count: matched.length, deletedQuestions: matched.map((e) => e.question) };
}

async function generateMoreEntries(sourceId: string, roleId: string, input: { dimensions: string[]; count: number }) {
  const source = await prisma.kmSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "找不到這份來源。" };

  const count = Math.min(Math.max(1, input.count || 5), 50);
  const dimensions = Array.isArray(input.dimensions) ? input.dimensions : [];
  const tallies = await prisma.tally.findMany({ where: { roleId }, orderBy: { order: "asc" } });
  const guidelines = await getSystemSetting(KM_OUTPUT_GUIDELINES_KEY);

  const system = buildSystemPrompt({ dimensions, tallies, countMin: count, countMax: count, guidelines });
  const content = buildUserContent(source);

  const response = await anthropic.messages.create({
    model: KM_ANALYSIS_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    ...(hasSourceUrls(source)
      ? { tools: [{ type: "web_fetch_20260318" as const, name: "web_fetch" as const, max_uses: webFetchMaxUses(source) }] }
      : {}),
    messages: [{ role: "user", content }],
  });

  await recordApiUsage({ model: KM_ANALYSIS_MODEL, purpose: "km_generate_more", usage: response.usage, roleId });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const drafts = parseFaqDrafts(text);

  if (drafts.length === 0) {
    return { error: "這次沒有產生出新的題目，可能是內容不足以支撐更多維度，可以換個維度再試。" };
  }

  const tallyIdByName = new Map(tallies.map((t) => [t.name, t.id]));

  await prisma.$transaction(
    drafts.map((f) =>
      prisma.kmEntry.create({
        data: {
          sourceId,
          question: f.question,
          answer: f.answer,
          tallyId: f.suggestedTally ? (tallyIdByName.get(f.suggestedTally) ?? null) : null,
          dimensionsUsed: dimensions,
          roleId,
        },
      }),
    ),
  );

  return { count: drafts.length, newQuestions: drafts.map((d) => d.question) };
}
