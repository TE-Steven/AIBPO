import { prisma } from "@/lib/db";

export const KM_OUTPUT_GUIDELINES_KEY = "km_output_guidelines";
// 機器人測試要打的 telligent API 位置（JSON），由平台超級管理員依公司設定。
export const BOT_TEST_TARGET_KEY = "bot_test_target";

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
