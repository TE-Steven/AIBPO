import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export type ProvisionCompanyInput = {
  companyName: string;
  username: string;
  displayName: string;
  password: string;
};

/**
 * 建一間新公司的完整初始狀態：公司本身、預設「管理者」角色（isSystem，全選單權限）、
 * 第一個公司管理員帳號。目前只有超級管理員代開公司（/platform/companies/new）會呼叫這個函式
 * ——沒有自助註冊，公司一律由超級管理員開通。
 */
export async function provisionCompany(input: ProvisionCompanyInput) {
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { name: input.companyName } });
    const role = await tx.role.create({
      data: { companyId: company.id, name: "管理者", description: "公司管理員的預設角色", isSystem: true },
    });
    const user = await tx.user.create({
      data: { username: input.username, displayName: input.displayName, passwordHash },
    });
    await tx.companyMembership.create({
      data: { userId: user.id, companyId: company.id, roleId: role.id, isCompanyAdmin: true },
    });

    // 讓新公司一開通就有完整功能可用：把全站共用的選單目錄，整包授權給這個新角色。
    const menus = await tx.menu.findMany();
    if (menus.length > 0) {
      await tx.roleMenu.createMany({ data: menus.map((m) => ({ roleId: role.id, menuId: m.id })) });
    }

    return { company, user };
  });
}
