import { prisma } from "@/lib/db";

export const KM_OUTPUT_GUIDELINES_KEY = "km_output_guidelines";

export async function getSystemSetting(key: string): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? "";
}

export async function setSystemSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
