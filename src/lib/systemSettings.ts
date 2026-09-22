import { prisma } from "@/lib/db";

export const KM_OUTPUT_GUIDELINES_KEY = "km_output_guidelines";

export async function getSystemSetting(companyId: string, key: string): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { companyId_key: { companyId, key } } });
  return row?.value ?? "";
}

export async function setSystemSetting(companyId: string, key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { companyId_key: { companyId, key } },
    update: { value },
    create: { companyId, key, value },
  });
}
