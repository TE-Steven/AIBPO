import type { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { judgeBotAnswer } from "@/lib/botJudge";

export const dynamic = "force-dynamic";

const CONCURRENCY = 4;

// 只重新做 AI 比對、不重問機器人（不用 token）：
// 補上還沒比對/比對失敗的題目，以及標準答案在上次比對後又被編輯過的題目。
// 題目文字被改過的不在這裡處理——機器人回答是針對舊題目的，要用「重新測試」重問。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return Response.json({ error: "請先登入。" }, { status: 401 });
  if (session.kind !== "user") return Response.json({ error: "平台超級管理員不能操作公司資料。" }, { status: 403 });

  const source = await prisma.kmSource.findUnique({ where: { id } });
  if (!source) return Response.json({ error: "找不到這個來源。" }, { status: 404 });
  if (source.roleId !== session.roleId) return Response.json({ error: "沒有權限。" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { runId?: unknown };
  const runId = typeof body.runId === "string" ? body.runId : "";
  const run = await prisma.botTestRun.findUnique({
    where: { id: runId },
    include: { results: { include: { entry: true } } },
  });
  if (!run || run.sourceId !== id) return Response.json({ error: "找不到這次測試。" }, { status: 404 });

  const targets = run.results.filter((r) => {
    if (r.status !== "ANSWERED" || !r.botAnswer) return false;
    if (r.entry && r.entry.question !== r.question) return false;
    const answerChanged = r.entry ? r.entry.answer !== r.expectedAnswer : false;
    return !r.judgeVerdict || r.judgeVerdict === "ERROR" || answerChanged;
  });

  const updated: { id: string; judgeVerdict: string; judgeReason: string | null }[] = [];
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const r = targets[next++];
      const expectedAnswer = r.entry?.answer ?? r.expectedAnswer;
      const judge = await judgeBotAnswer({
        question: r.question,
        expectedAnswer,
        botAnswer: r.botAnswer!,
        roleId: source!.roleId,
      });
      await prisma.botTestResult.update({
        where: { id: r.id },
        data: { expectedAnswer, judgeVerdict: judge.verdict, judgeReason: judge.reason },
      });
      updated.push({ id: r.id, judgeVerdict: judge.verdict, judgeReason: judge.reason });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  return Response.json({ results: updated });
}
