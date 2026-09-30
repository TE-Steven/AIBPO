import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBotTestTarget } from "@/lib/botTest";
import type { PromptConfigData } from "@/lib/promptConfig";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace";
import type { TestCaseView, VersionView } from "./knowledgeTypes";

function tallyLabel(t: { name: string; parent?: { name: string; parent?: { name: string } | null } | null }): string {
  const chain = [t.parent?.parent?.name, t.parent?.name, t.name].filter(Boolean);
  return chain.join(" › ");
}

// 版本「當時設定」裡改過的數值與匯出選項，用使用者看得懂的名稱顯示
const OPTION_LABELS: Record<string, string> = {
  faqCountMin: "FAQ 題數下限",
  faqCountMax: "FAQ 題數上限",
  docMissingText: "缺漏欄位文字",
  docOverviewField: "補充說明欄位",
  docSelfContainedHeadings: "整份下載標題帶項目名稱",
  exportFrontmatter: "匯出 frontmatter",
  exportGroupBy: "匯出分組方式",
  exportQuestionFormat: "匯出題目格式",
  exportIncludeDocs: "匯出包含結構化文件",
};

export default async function KnowledgePage() {
  const session = await requireSession();

  const [entries, tallies, versions, testCases, target] = await Promise.all([
    prisma.kmEntry.findMany({
      where: { confirmed: true, ...roleScope(session) },
      include: { source: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tally.findMany({
      where: roleScope(session),
      include: { parent: { include: { parent: true } } },
      orderBy: { order: "asc" },
    }),
    prisma.kbVersion.findMany({
      where: roleScope(session),
      select: {
        id: true,
        name: true,
        note: true,
        createdAt: true,
        entryCount: true,
        settings: true,
        // 每個版本只帶最近一次測試（含每題結果），版本比較用
        testRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { results: { orderBy: { order: "asc" } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.testCase.findMany({ where: roleScope(session), orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    session.kind === "user" ? getBotTestTarget(session.companyId) : Promise.resolve(null),
  ]);

  const tallyOptions = tallies.map((t) => ({ id: t.id, label: tallyLabel(t) }));
  const listEntries = entries.map((e) => ({
    id: e.id,
    question: e.question,
    answer: e.answer,
    tallyId: e.tallyId,
    kind: e.kind,
    sourceId: e.source.id,
    sourceTitle: e.source.title,
  }));
  const sourceOptions = Array.from(new Map(listEntries.map((e) => [e.sourceId, e.sourceTitle])).entries())
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));

  const versionViews: VersionView[] = versions.map((v) => {
    const settings = (v.settings ?? {}) as {
      promptConfig?: PromptConfigData;
      guidelines?: string;
      tallies?: { path: string; description: string | null }[];
    };
    const run = v.testRuns[0];
    return {
      id: v.id,
      name: v.name,
      note: v.note,
      createdAt: v.createdAt.toISOString(),
      entryCount: v.entryCount,
      settings: {
        guidelines: settings.guidelines ?? "",
        modifiedRules: Object.keys(settings.promptConfig?.rules ?? {}),
        modifiedOptions: Object.keys(settings.promptConfig?.options ?? {}).map((k) => OPTION_LABELS[k] ?? k),
        tallies: settings.tallies ?? [],
      },
      latestRun: run
        ? {
            id: run.id,
            status: run.status,
            total: run.total,
            completed: run.completed,
            errorMessage: run.errorMessage,
            createdAt: run.createdAt.toISOString(),
            results: run.results.map((r) => ({
              testCaseId: r.testCaseId,
              order: r.order,
              question: r.question,
              expectedAnswer: r.expectedAnswer,
              botAnswer: r.botAnswer,
              status: r.status,
              errorMessage: r.errorMessage,
              judgeVerdict: r.judgeVerdict,
              judgeReason: r.judgeReason,
            })),
          }
        : null,
    };
  });

  const testCaseViews: TestCaseView[] = testCases.map((t) => ({
    id: t.id,
    question: t.question,
    expectedAnswer: t.expectedAnswer,
    archived: t.archived,
    createdAt: t.createdAt.toISOString(),
  }));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">知識列表</h1>
        <p className="mt-1 text-sm text-slate-500">
          在「來源管理」勾選確認過的 FAQ 與結構化文件都會出現在這裡。勾選題目可以匯出、建立版本、加入測試題庫；每個版本用同一套題庫測試，比較哪一版 chatbot 答得最好。
        </p>
      </div>

      <KnowledgeWorkspace
        listProps={{ entries: listEntries, tallyOptions, sourceOptions }}
        versions={versionViews}
        testCases={testCaseViews}
        targetReady={Boolean(target)}
      />
    </div>
  );
}
