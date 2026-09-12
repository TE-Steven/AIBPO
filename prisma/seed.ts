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
  { key: "km-new", label: "新增KM", path: "/km/new", icon: "sparkles", order: 1 },
  { key: "km-tally", label: "分類管理", path: "/km/tally", icon: "menu-list", order: 2 },
  { key: "km-dimensions", label: "維度管理", path: "/km/dimensions", icon: "shield-check", order: 3 },
];

async function main() {
  const defaultRole = await prisma.role.upsert({
    where: { name: "一般使用者" },
    update: {},
    create: { name: "一般使用者", description: "系統預設角色", isSystem: true },
  });

  for (const m of DEFAULT_MENUS) {
    const menu = await prisma.menu.upsert({
      where: { key: m.key },
      update: { label: m.label, path: m.path, icon: m.icon, order: m.order },
      create: m,
    });

    await prisma.roleMenu.upsert({
      where: { roleId_menuId: { roleId: defaultRole.id, menuId: menu.id } },
      update: {},
      create: { roleId: defaultRole.id, menuId: menu.id },
    });
  }

  const kmParentMenu = await prisma.menu.upsert({
    where: { key: KM_PARENT.key },
    update: { label: KM_PARENT.label, path: KM_PARENT.path, icon: KM_PARENT.icon, order: KM_PARENT.order },
    create: KM_PARENT,
  });

  for (const m of KM_CHILDREN) {
    const menu = await prisma.menu.upsert({
      where: { key: m.key },
      update: { label: m.label, path: m.path, icon: m.icon, order: m.order, parentId: kmParentMenu.id },
      create: { ...m, parentId: kmParentMenu.id },
    });

    // KM 子選單預設就開放給預設角色使用（跟其他預設選單一致）。
    await prisma.roleMenu.upsert({
      where: { roleId_menuId: { roleId: defaultRole.id, menuId: menu.id } },
      update: {},
      create: { roleId: defaultRole.id, menuId: menu.id },
    });
  }

  console.log("AIBPO 種子資料建立完成：預設角色與選單已就緒。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
