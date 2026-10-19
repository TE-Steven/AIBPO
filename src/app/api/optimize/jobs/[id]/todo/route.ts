import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { computeJobTodo, type TodoQuestion } from "@/lib/optimizationTodo";

export const dynamic = "force-dynamic";

// 下載自動優化的待處理清單（Excel）：原文沒有、機器人問題、關鍵答案可能太嚴、還在處理，各一個工作表

const VERDICT: Record<string, string> = { MATCH: "一致", PARTIAL: "部分一致", MISMATCH: "不一致" };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const job = await prisma.optimizationJob.findUnique({ where: { id }, select: { roleId: true, seq: true } });
  if (!job) return new Response("Not found", { status: 404 });
  if (session.kind !== "superadmin" && job.roleId !== session.roleId) return new Response("Forbidden", { status: 403 });
  const todo = await computeJobTodo(id);
  if (!todo) return new Response("這個任務還沒有測過的版本。", { status: 404 });

  const workbook = new ExcelJS.Workbook();
  function addSheet(name: string, headers: [string, number][], rows: (string | number | null)[][]) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = headers.map(([header, width]) => ({ header, width }));
    sheet.getRow(1).font = { bold: true };
    for (const r of rows) sheet.addRow(r);
    sheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  }
  const questionRows = (list: TodoQuestion[], withNote: boolean) =>
    list.map((q) => [q.question, q.expectedAnswer, q.botAnswer ?? "（沒有回答）", VERDICT[q.verdict ?? ""] ?? "未回答", ...(withNote ? [q.note ?? "", q.diagnosedIn ?? ""] : [])]);
  const qHeaders: [string, number][] = [
    ["題目", 36],
    ["標準答案", 50],
    [`機器人回答（${todo.bestVersionName}）`, 50],
    ["結果", 10],
  ];

  addSheet("原文沒有", [...qHeaders, ["AI 判斷缺少的內容", 40], ["判斷的版本", 12]], questionRows(todo.notInSource, true));
  addSheet("機器人問題", [...qHeaders, ["AI 的判斷", 40], ["判斷的版本", 12]], questionRows(todo.retrieval, true));
  addSheet(
    "關鍵答案可能太嚴",
    [
      ["題目", 36],
      ["標準答案", 50],
      ["一直漏掉的必要點", 36],
      ["幾個版本都漏", 14],
      [`機器人回答（${todo.bestVersionName}）`, 50],
    ],
    todo.strictKeyPoints.map((p) => [p.question, p.expectedAnswer, p.point, `${p.missedIn}／${p.testedVersions}`, p.botAnswer ?? "（沒有回答）"]),
  );
  addSheet("還在處理", [...qHeaders, ["最近一次 AI 的判斷", 40], ["判斷的版本", 12]], questionRows(todo.stillWorking, true));

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const name = encodeURIComponent(`自動優化待處理清單-#${job.seq}.xlsx`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="optimization-todo.xlsx"; filename*=UTF-8''${name}`,
    },
  });
}
