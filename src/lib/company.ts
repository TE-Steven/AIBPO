import { prisma } from "@/lib/db";

/** 從 roleId 反查所屬公司 id：Role 現在一定屬於某間公司，一個 roleId 只會對應一間公司。 */
export async function companyIdForRole(roleId: string): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { id: roleId }, select: { companyId: true } });
  return role.companyId;
}
