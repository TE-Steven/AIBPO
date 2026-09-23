-- 多租戶 SaaS 改造：新增 Company，並把既有唯一一份資料回填成一間公司。
-- 這份 SQL 是手寫的（不是 `prisma migrate dev` 自動產生），因為 Role/User 加的是必填欄位，
-- SystemSetting 主鍵整個換掉，中間都需要先backfill 資料再收緊成 NOT NULL / 換主鍵，
-- 不能讓 Prisma 自動產生的遷移直接套用在已經有資料的表上。
--
-- 固定 cuid，讓這份 SQL 可以在 staging 先跑過一次再套到正式環境，結果是確定的。
-- 套用前後都可以用 `SELECT * FROM aibpo_companies;` 確認只多了這一筆。

-- 0) 建立 Company 表本身（這步在原本手寫時漏掉了，只寫了回填邏輯，忘了表都還沒建）
CREATE TABLE "aibpo_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_companies_pkey" PRIMARY KEY ("id")
);

-- 1) 建立唯一一間既有公司
INSERT INTO "aibpo_companies" (id, name, "createdAt", "updatedAt")
VALUES ('b3d2b67f-5ed1-42cf-bbe6-07891bb5c00b', '預設公司（原單一租戶，可之後改名）', now(), now());

-- 2) Role.companyId：加欄位 → 回填 → 收緊成 NOT NULL → 加 FK → 唯一索引從 name 換成 (companyId, name)
ALTER TABLE "aibpo_roles" ADD COLUMN "companyId" TEXT;
UPDATE "aibpo_roles" SET "companyId" = 'b3d2b67f-5ed1-42cf-bbe6-07891bb5c00b';
ALTER TABLE "aibpo_roles" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "aibpo_roles"
  ADD CONSTRAINT "aibpo_roles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "aibpo_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- 注意：單欄位的 @unique 在 Postgres 只會變成一個 unique INDEX，不是 pg_constraint 裡的 constraint，
-- 用 DROP CONSTRAINT 砍不掉（會被 IF EXISTS 靜默吞掉），實際套用時漏了這步，之後用 DROP INDEX 補上。
DROP INDEX IF EXISTS "aibpo_roles_name_key";
CREATE UNIQUE INDEX "aibpo_roles_companyId_name_key" ON "aibpo_roles"("companyId", "name");
CREATE INDEX "aibpo_roles_companyId_idx" ON "aibpo_roles"("companyId");

-- 3) User.companyId：同樣三步驟回填；isCompanyAdmin 是單純加欄位，不用回填邏輯
ALTER TABLE "aibpo_users" ADD COLUMN "companyId" TEXT;
UPDATE "aibpo_users" SET "companyId" = 'b3d2b67f-5ed1-42cf-bbe6-07891bb5c00b';
ALTER TABLE "aibpo_users" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "aibpo_users"
  ADD CONSTRAINT "aibpo_users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "aibpo_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "aibpo_users_companyId_idx" ON "aibpo_users"("companyId");
ALTER TABLE "aibpo_users" ADD COLUMN "isCompanyAdmin" BOOLEAN NOT NULL DEFAULT false;

-- 4) ApiUsageLog.companyId：nullable，只回填「有 roleId」的歷史紀錄（roleId 是 null 的本來就是 superadmin 觸發，維持兩者皆 null）
ALTER TABLE "aibpo_api_usage_logs" ADD COLUMN "companyId" TEXT;
UPDATE "aibpo_api_usage_logs" SET "companyId" = 'b3d2b67f-5ed1-42cf-bbe6-07891bb5c00b' WHERE "roleId" IS NOT NULL;
CREATE INDEX "aibpo_api_usage_logs_companyId_idx" ON "aibpo_api_usage_logs"("companyId");

-- 5) SystemSetting：加 companyId、回填、把主鍵從單獨的 key 換成複合主鍵 (companyId, key)
ALTER TABLE "aibpo_system_settings" ADD COLUMN "companyId" TEXT;
UPDATE "aibpo_system_settings" SET "companyId" = 'b3d2b67f-5ed1-42cf-bbe6-07891bb5c00b';
ALTER TABLE "aibpo_system_settings" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "aibpo_system_settings" DROP CONSTRAINT IF EXISTS "aibpo_system_settings_pkey";
ALTER TABLE "aibpo_system_settings" ADD CONSTRAINT "aibpo_system_settings_pkey" PRIMARY KEY ("companyId", "key");

-- 套用後手動追加（不寫進這份 SQL，因為「哪個帳號是公司管理員」是業務決定不是 schema 事實）：
--   UPDATE "aibpo_users" SET "isCompanyAdmin" = true WHERE username = '<選一個現有帳號>';
