import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { resolveSsl } from "../src/lib/dbSsl";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString, ssl: resolveSsl(connectionString) }, { schema: "aibpo" });
const prisma = new PrismaClient({ adapter });

const DEFAULT_MENUS = [
  { key: "dashboard", label: "儀表板", path: "/", icon: "dashboard", order: 1 },
  { key: "team", label: "團隊成員", path: "/team", icon: "users", order: 2 },
  { key: "profile", label: "個人設定", path: "/settings/profile", icon: "user-circle", order: 3 },
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
