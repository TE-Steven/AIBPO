import { prisma } from "@/lib/db";
import { estimateUsdCost, USD_TO_TWD_RATE } from "@/lib/anthropic";
import { LINE_NOTIFY_KEY } from "@/lib/lineNotify";

// 營運島（平台超級管理員的 3D 總覽）用的資料快照：每個功能模組的清單與最近動態。
// 只給超級管理員看；只放名稱、狀態、數量，不放 FAQ／文件內容、金鑰，帳號也遮罩。
// public/platform-island.html 每 15 秒抓一次 /api/platform/island，用 activity 的 id 判斷哪些是新動態。

const DAY = 86_400_000;
const TAIPEI_OFFSET = 8 * 3_600_000;
const ACTIVITY_WINDOW = 2 * DAY;

type Flow = [string, string];
export type IslandActivity = { id: string; t: number; mod: string; company: string | null; text: string; flows: Flow[] };

function taipeiDayStart(now: number) {
  return Math.floor((now + TAIPEI_OFFSET) / DAY) * DAY - TAIPEI_OFFSET;
}
function taipeiMonthStart(now: number) {
  const d = new Date(now + TAIPEI_OFFSET);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - TAIPEI_OFFSET;
}
function maskAccount(username: string) {
  const [name, domain] = username.split("@");
  const masked = name.length <= 2 ? `${name[0] ?? ""}***` : `${name[0]}***${name.slice(-2)}`;
  return domain ? `${masked}@${domain}` : masked;
}
function fileCount(source: { sourceFileIds: unknown; sourceUrls: unknown; sourceFileId: string | null; sourceUrl: string | null }) {
  const files = Array.isArray(source.sourceFileIds) ? source.sourceFileIds.length : source.sourceFileId ? 1 : 0;
  const urls = Array.isArray(source.sourceUrls) ? source.sourceUrls.length : source.sourceUrl ? 1 : 0;
  return files + urls;
}
function sourceStatus(s: { status: string; ragStatus: string; docStatus: string; workflowStatus: string }) {
  if ([s.status, s.ragStatus, s.docStatus, s.workflowStatus].some((x) => x === "PROCESSING" || x === "PENDING") && s.status !== "FAILED") return "ANALYZING";
  if (s.status === "FAILED") return "FAILED";
  if (s.status === "DONE") return "ANALYZED";
  return "UPLOADED";
}
const jobMod = (type: string) => (type === "FAQ" ? "faq" : "rag");
const jobLabel = (type: string) => (type === "FAQ" ? "FAQ" : "RAG");

export async function buildIslandSnapshot() {
  const now = Date.now();
  const today = new Date(taipeiDayStart(now));
  const month = new Date(taipeiMonthStart(now));
  const since = new Date(now - ACTIVITY_WINDOW);
  const week = new Date(now - 7 * DAY);

  const [companies, roles, memberships, sources, entryCounts, docs, docTotals, docBursts, dims, cats, skills, agents, drafts, jobs, forms, botRuns, versionRuns, versions, usageMonth, usageToday, chatsToday, lineSettings] =
    await Promise.all([
      prisma.company.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, createdAt: true, _count: { select: { roles: true } } } }),
      prisma.role.findMany({ select: { id: true, companyId: true } }),
      prisma.companyMembership.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, companyId: true, isCompanyAdmin: true, isActive: true, createdAt: true, role: { select: { name: true } }, user: { select: { displayName: true, username: true } } },
      }),
      prisma.kmSource.findMany({
        orderBy: { updatedAt: "desc" },
        take: 300,
        select: { id: true, roleId: true, title: true, status: true, ragStatus: true, docStatus: true, workflowStatus: true, sourceFileIds: true, sourceUrls: true, sourceFileId: true, sourceUrl: true, createdAt: true, updatedAt: true },
      }),
      prisma.kmEntry.groupBy({ by: ["sourceId"], _count: { _all: true } }),
      prisma.kmEntry.findMany({ where: { kind: "DOC" }, orderBy: { updatedAt: "desc" }, take: 300, select: { id: true, roleId: true, question: true, updatedAt: true, tally: { select: { name: true } } } }),
      prisma.kmEntry.groupBy({ by: ["roleId"], where: { kind: "DOC" }, _count: { _all: true } }),
      prisma.kmEntry.groupBy({ by: ["sourceId", "roleId"], where: { kind: "DOC", createdAt: { gte: since } }, _count: { _all: true }, _max: { createdAt: true } }),
      prisma.dimension.findMany({ select: { id: true, roleId: true, name: true, description: true } }),
      prisma.tally.groupBy({ by: ["roleId"], _count: { _all: true } }),
      prisma.skill.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, roleId: true, name: true, createdAt: true, _count: { select: { agentSkills: true } } } }),
      prisma.agent.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, roleId: true, name: true, status: true, createdAt: true, _count: { select: { agentSkills: true } } } }),
      prisma.agentDraft.findMany({ orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, roleId: true, suggestedName: true, confirmed: true, createdAt: true, updatedAt: true } }),
      prisma.optimizationJob.findMany({
        where: { OR: [{ status: { in: ["RUNNING", "PAUSED_TOKEN"] } }, { updatedAt: { gte: new Date(now - 60 * DAY) } }] },
        orderBy: { updatedAt: "desc" },
        take: 150,
        select: {
          id: true, roleId: true, seq: true, optimizeType: true, status: true, currentRun: true, currentStep: true, maxRuns: true, targetScore: true, createdAt: true, updatedAt: true,
          source: { select: { title: true } },
          _count: { select: { versions: true } },
          versions: { orderBy: { createdAt: "desc" }, take: 1, select: { scoreAll: true } },
        },
      }),
      prisma.automationForm.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, roleId: true, name: true, domain: true, status: true, fields: true, analyzedAt: true, createdAt: true, updatedAt: true } }),
      prisma.botTestRun.findMany({ where: { createdAt: { gte: week } }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, roleId: true, status: true, total: true, completed: true, botName: true, createdAt: true, source: { select: { title: true } } } }),
      prisma.versionTestRun.findMany({ where: { createdAt: { gte: week } }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, roleId: true, status: true, total: true, completed: true, botName: true, createdAt: true, version: { select: { name: true, scoreAll: true } } } }),
      prisma.kbVersion.findMany({
        where: { jobId: { not: null }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, roleId: true, runIndex: true, scoreAll: true, createdAt: true, job: { select: { seq: true, optimizeType: true, source: { select: { title: true } } } } },
      }),
      prisma.apiUsageLog.groupBy({ by: ["companyId", "model"], where: { createdAt: { gte: month } }, _sum: { inputTokens: true, outputTokens: true, cacheCreationTokens: true, cacheReadTokens: true } }),
      prisma.apiUsageLog.groupBy({ by: ["companyId", "model"], where: { createdAt: { gte: today } }, _sum: { inputTokens: true, outputTokens: true, cacheCreationTokens: true, cacheReadTokens: true } }),
      prisma.apiUsageLog.groupBy({ by: ["companyId"], where: { createdAt: { gte: today }, purpose: "agent_chat" }, _count: { _all: true } }),
      prisma.systemSetting.findMany({ where: { key: LINE_NOTIFY_KEY }, select: { companyId: true, value: true } }),
    ]);

  const companyOf = new Map(roles.map((r) => [r.id, r.companyId]));
  const cid = (roleId: string) => companyOf.get(roleId) ?? null;
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const entriesBySource = new Map(entryCounts.map((e) => [e.sourceId, e._count._all]));
  const sumByCompany = (rows: { roleId: string; _count: { _all: number } }[]) => {
    const out: Record<string, number> = {};
    for (const r of rows) { const c = cid(r.roleId); if (c) out[c] = (out[c] ?? 0) + r._count._all; }
    return out;
  };
  const jobName = (j: { seq: number; source: { title: string } | null }) => `${j.source?.title ?? "知識列表"}（v${j.seq}）`;

  const costRows = (rows: typeof usageMonth) => {
    const out = new Map<string, { tokens: number; cost: number }>();
    for (const r of rows) {
      const key = r.companyId ?? "platform";
      const s = r._sum;
      const cur = out.get(key) ?? { tokens: 0, cost: 0 };
      cur.tokens += (s.inputTokens ?? 0) + (s.outputTokens ?? 0) + (s.cacheCreationTokens ?? 0) + (s.cacheReadTokens ?? 0);
      cur.cost += estimateUsdCost(r.model, s.inputTokens ?? 0, s.outputTokens ?? 0, s.cacheCreationTokens ?? 0, s.cacheReadTokens ?? 0) * USD_TO_TWD_RATE;
      out.set(key, cur);
    }
    return out;
  };
  const monthCost = costRows(usageMonth);
  const todayCost = costRows(usageToday);
  const chats = new Map(chatsToday.map((r) => [r.companyId ?? "platform", r._count._all]));

  const lineGroups = lineSettings.flatMap((s) => {
    try {
      const groups = (JSON.parse(s.value || "{}") as { groups?: { name?: string | null }[] }).groups;
      return Array.isArray(groups) ? groups.map((g, i) => ({ id: `${s.companyId}-g${i}`, companyId: s.companyId, name: g?.name || "未命名群組" })) : [];
    } catch {
      return [];
    }
  });
  const lineCompanies = new Set(lineGroups.map((g) => g.companyId));

  const jobItems = jobs.map((j) => ({
    id: j.id, companyId: cid(j.roleId), type: jobLabel(j.optimizeType), name: jobName(j), status: j.status, round: j.currentRun, maxRounds: j.maxRuns,
    score: j.versions[0]?.scoreAll ?? null, target: j.targetScore, versions: j._count.versions, step: j.currentStep, startedAt: j.createdAt.getTime(), updatedAt: j.updatedAt.getTime(),
  }));
  const finishedJobs = jobs.filter((j) => ["DONE", "STOPPED", "FAILED", "PAUSED_TOKEN"].includes(j.status) && j.updatedAt >= since);

  // 最近動態：各資料表的時間戳整理成事件，id 固定（前端用來判斷哪些是新的）
  const activity: IslandActivity[] = [];
  const push = (a: IslandActivity) => activity.push(a);
  for (const v of versions) {
    if (!v.job) continue;
    const mod = jobMod(v.job.optimizeType);
    push({ id: `ver-${v.id}`, t: v.createdAt.getTime(), mod, company: cid(v.roleId), flows: [[mod, "bottest"], ["bottest", mod], [mod, "usage"]],
      text: `${jobLabel(v.job.optimizeType)}優化「${jobName(v.job)}」第 ${v.runIndex ?? "?"} 輪完成${v.scoreAll != null ? `，答對率 ${v.scoreAll}%` : ""}` });
  }
  for (const j of jobs) {
    const mod = jobMod(j.optimizeType);
    if (j.createdAt >= since) push({ id: `jobstart-${j.id}`, t: j.createdAt.getTime(), mod, company: cid(j.roleId), flows: [["tally", mod]], text: `開始 ${jobLabel(j.optimizeType)}優化「${jobName(j)}」` });
  }
  for (const j of finishedJobs) {
    const mod = jobMod(j.optimizeType);
    const word = { DONE: "完成", STOPPED: "已停止", FAILED: "失敗", PAUSED_TOKEN: "暫停（等待 token）" }[j.status] ?? j.status;
    push({ id: `jobend-${j.id}-${j.status}`, t: j.updatedAt.getTime(), mod, company: cid(j.roleId), flows: lineCompanies.has(cid(j.roleId) ?? "") ? [[mod, "line"]] : [],
      text: `${jobLabel(j.optimizeType)}優化「${jobName(j)}」${word}${j.versions[0]?.scoreAll != null ? `，最後答對率 ${j.versions[0].scoreAll}%` : ""}` });
  }
  for (const s of sources) {
    if (s.createdAt >= since) push({ id: `src-${s.id}`, t: s.createdAt.getTime(), mod: "km", company: cid(s.roleId), flows: [["company", "km"]], text: `上傳來源「${s.title}」` });
  }
  for (const b of docBursts) {
    if (!b._max.createdAt) continue;
    const title = sources.find((s) => s.id === b.sourceId)?.title ?? "來源";
    push({ id: `docs-${b.sourceId}-${b._count._all}`, t: b._max.createdAt.getTime(), mod: "tally", company: cid(b.roleId), flows: [["km", "tally"]], text: `「${title}」產生 ${b._count._all} 份結構化文件` });
  }
  for (const f of forms) {
    if (f.createdAt >= since) push({ id: `form-${f.id}`, t: f.createdAt.getTime(), mod: "automation", company: cid(f.roleId), flows: [], text: `登記表單「${f.name}」（${f.domain}）` });
    if (f.analyzedAt && f.analyzedAt >= since) {
      const word = f.status === "BLOCKED" ? "偵測到不支援的頁面" : f.status === "FAILED" ? "分析失敗" : `分析完成，${Array.isArray(f.fields) ? f.fields.length : 0} 個欄位`;
      push({ id: `formdone-${f.id}-${f.analyzedAt.getTime()}`, t: f.analyzedAt.getTime(), mod: "automation", company: cid(f.roleId), flows: [["automation", "usage"]], text: `表單「${f.name}」${word}` });
    }
  }
  for (const m of memberships) {
    if (m.createdAt >= since) push({ id: `mem-${m.id}`, t: m.createdAt.getTime(), mod: "company", company: m.companyId, flows: [], text: `${companyName.get(m.companyId) ?? ""} 新增帳號 ${m.user.displayName}（${m.isCompanyAdmin ? "管理員" : m.role.name}）` });
  }
  for (const a of agents) if (a.createdAt >= since) push({ id: `agent-${a.id}`, t: a.createdAt.getTime(), mod: "agent", company: cid(a.roleId), flows: [["skill", "agent"]], text: `建立 Agent「${a.name}」` });
  for (const s of skills) if (s.createdAt >= since) push({ id: `skill-${s.id}`, t: s.createdAt.getTime(), mod: "skill", company: cid(s.roleId), flows: [], text: `新增 Skill「${s.name}」` });
  for (const d of drafts) if (d.createdAt >= since) push({ id: `draft-${d.id}`, t: d.createdAt.getTime(), mod: "draft", company: cid(d.roleId), flows: [["km", "draft"]], text: `產生 Workflow 草稿「${d.suggestedName}」` });
  for (const r of botRuns) if (r.createdAt >= since) push({ id: `bot-${r.id}`, t: r.createdAt.getTime(), mod: "bottest", company: cid(r.roleId), flows: [["km", "bottest"]], text: `${r.botName ?? "機器人"} 測試「${r.source.title}」${r.total} 題` });
  activity.sort((a, b) => b.t - a.t);

  return {
    generatedAt: now,
    todayStart: today.getTime(),
    companies: companies.map((c) => ({ id: c.id, name: c.name, since: c.createdAt.toISOString().slice(0, 7), roles: c._count.roles })),
    users: memberships.map((m) => ({ id: m.id, companyId: m.companyId, name: m.user.displayName, email: maskAccount(m.user.username), role: m.isCompanyAdmin ? "管理員" : m.role.name, active: m.isActive, joinedAt: m.createdAt.getTime() })),
    sources: sources.map((s) => ({ id: s.id, companyId: cid(s.roleId), title: s.title, files: fileCount(s), fields: entriesBySource.get(s.id) ?? 0, status: sourceStatus(s), updatedAt: s.updatedAt.getTime() })),
    docs: docs.map((d) => ({ id: d.id, companyId: cid(d.roleId), template: d.tally?.name ?? "結構化文件", entity: d.question, updatedAt: d.updatedAt.getTime() })),
    docTotals: sumByCompany(docTotals),
    dims: dims.map((d) => ({ id: d.id, companyId: cid(d.roleId), name: d.name, description: d.description ?? "" })),
    cats: sumByCompany(cats),
    skills: skills.map((s) => ({ id: s.id, companyId: cid(s.roleId), name: s.name, usedBy: s._count.agentSkills })),
    agents: agents.map((a) => ({ id: a.id, companyId: cid(a.roleId), name: a.name, status: a.status === "ACTIVE" ? "ONLINE" : "DRAFT", skills: a._count.agentSkills })),
    drafts: drafts.map((d) => ({ id: d.id, companyId: cid(d.roleId), name: d.suggestedName, confirmed: d.confirmed, updatedAt: d.updatedAt.getTime() })),
    jobs: jobItems,
    forms: forms.map((f) => ({ id: f.id, companyId: cid(f.roleId), name: f.name, domain: f.domain, status: f.status === "DRAFT" ? "ANALYZING" : f.status, fields: Array.isArray(f.fields) ? f.fields.length : 0, updatedAt: f.updatedAt.getTime() })),
    tests: [
      ...botRuns.map((r) => ({ id: r.id, companyId: cid(r.roleId), name: `${r.botName ?? "機器人"}・${r.source.title}`, questions: r.total, completed: r.completed, pass: null as number | null, status: r.status, at: r.createdAt.getTime() })),
      ...versionRuns.map((r) => ({ id: r.id, companyId: cid(r.roleId), name: `${r.botName ?? "機器人"}・${r.version.name}`, questions: r.total, completed: r.completed, pass: r.status === "DONE" ? r.version.scoreAll : null, status: r.status, at: r.createdAt.getTime() })),
    ].sort((a, b) => b.at - a.at),
    usage: [...companies.map((c) => c.id), ...(monthCost.has("platform") ? ["platform"] : [])].map((id) => ({
      companyId: id, tokensToday: todayCost.get(id)?.tokens ?? 0, costToday: Math.round(todayCost.get(id)?.cost ?? 0), costMonth: Math.round(monthCost.get(id)?.cost ?? 0), chatsToday: chats.get(id) ?? 0,
    })),
    lineGroups,
    notices: finishedJobs
      .filter((j) => lineCompanies.has(cid(j.roleId) ?? ""))
      .map((j) => ({ id: `n-${j.id}`, companyId: cid(j.roleId), text: `${jobLabel(j.optimizeType)}優化「${jobName(j)}」${j.status === "DONE" ? "完成" : j.status === "FAILED" ? "失敗" : "停止"}通知`, status: "SENT", failed: j.status === "FAILED", at: j.updatedAt.getTime() })),
    activity: activity.slice(0, 40),
  };
}
export type IslandSnapshot = Awaited<ReturnType<typeof buildIslandSnapshot>>;
