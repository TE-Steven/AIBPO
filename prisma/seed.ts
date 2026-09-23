import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { resolveConnection } from "../src/lib/dbSsl";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
const { connectionString, ssl } = resolveConnection(process.env.DATABASE_URL);
const adapter = new PrismaPg({ connectionString, ssl }, { schema: "aibpo" });
const prisma = new PrismaClient({ adapter });

const DEFAULT_MENUS = [
  { key: "dashboard", label: "儀表板", path: "/", icon: "dashboard", order: 1 },
  { key: "team", label: "團隊成員", path: "/team", icon: "users", order: 2 },
  { key: "profile", label: "個人設定", path: "/settings/profile", icon: "user-circle", order: 3 },
];

// KM 管理是兩層選單：「KM管理」是純標題群組（path 留空，不能直接點），底下三個子選單才是真正的頁面。
const KM_PARENT = { key: "km", label: "KM管理", path: "", icon: "sparkles", order: 4 };
const KM_CHILDREN = [
  { key: "km-new", label: "來源管理", path: "/km/new", icon: "sparkles", order: 1 },
  { key: "km-knowledge", label: "知識列表", path: "/km/knowledge", icon: "menu-list", order: 2 },
  { key: "km-tally", label: "分類管理", path: "/km/tally", icon: "menu-list", order: 3 },
  { key: "km-dimensions", label: "維度管理", path: "/km/dimensions", icon: "shield-check", order: 4 },
];

// AI Agent 也是兩層選單：Skill 管理定義可重用工具，Agent 管理是拖曳畫布把工具組成具名助手。
const AGENT_PARENT = { key: "agent", label: "AI Agent", path: "", icon: "wrench", order: 5 };
const AGENT_CHILDREN = [
  { key: "agent-skills", label: "Skill 管理", path: "/skills", icon: "wrench", order: 1 },
  { key: "agent-list", label: "Agent 管理", path: "/agents", icon: "sparkles", order: 2 },
  { key: "agent-drafts", label: "Workflow 草稿", path: "/agents/drafts", icon: "sparkles", order: 3 },
];

// 多租戶化之後，公司／角色／使用者都是自助註冊或超級管理員代開時才建立（見 src/lib/companyProvisioning.ts），
// 這份 seed 只負責準備全站共用的選單目錄本身——新公司建立時會把當下所有 Menu 整包授權給它的第一個角色。
// 注意：Render 的啟動指令每次部署都會重跑這個 seed，所以這裡絕對不能建立 Company/Role/User，
// 之前版本用固定 id upsert 出一間「seed-default-company」，結果每次部署後台都多一間空的幽靈公司。
async function main() {
  for (const m of DEFAULT_MENUS) {
    await prisma.menu.upsert({
      where: { key: m.key },
      update: { label: m.label, path: m.path, icon: m.icon, order: m.order },
      create: m,
    });
  }

  const kmParentMenu = await prisma.menu.upsert({
    where: { key: KM_PARENT.key },
    update: { label: KM_PARENT.label, path: KM_PARENT.path, icon: KM_PARENT.icon, order: KM_PARENT.order },
    create: KM_PARENT,
  });

  for (const m of KM_CHILDREN) {
    await prisma.menu.upsert({
      where: { key: m.key },
      update: { label: m.label, path: m.path, icon: m.icon, order: m.order, parentId: kmParentMenu.id },
      create: { ...m, parentId: kmParentMenu.id },
    });
  }

  const agentParentMenu = await prisma.menu.upsert({
    where: { key: AGENT_PARENT.key },
    update: { label: AGENT_PARENT.label, path: AGENT_PARENT.path, icon: AGENT_PARENT.icon, order: AGENT_PARENT.order },
    create: AGENT_PARENT,
  });

  for (const m of AGENT_CHILDREN) {
    await prisma.menu.upsert({
      where: { key: m.key },
      update: { label: m.label, path: m.path, icon: m.icon, order: m.order, parentId: agentParentMenu.id },
      create: { ...m, parentId: agentParentMenu.id },
    });
  }

  console.log("AIBPO 種子資料建立完成：選單目錄已就緒。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
