-- 一個帳號可跨多間公司：把「人」（aibpo_users：帳號/密碼/顯示名稱）跟「這個人在某間公司底下的身分」
-- （aibpo_company_memberships：角色/是否公司管理員/是否啟用）拆開。
-- 手寫 SQL（不是 `prisma migrate dev` 自動產生）：因為要先把既有 User 列的 companyId/roleId/isCompanyAdmin/isActive
-- 複製成對應的 CompanyMembership 列，才能安全砍掉 aibpo_users 上的這幾個必填欄位。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0) 建立 CompanyMembership 表本身（先不加 FK，backfill 完再加）
CREATE TABLE "aibpo_company_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isCompanyAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_company_memberships_pkey" PRIMARY KEY ("id")
);

-- 1) 回填：今天的不變量是「一人一公司一角色」，所以一筆 User 對應一筆 CompanyMembership，直接 1:1 複製。
INSERT INTO "aibpo_company_memberships" (id, "userId", "companyId", "roleId", "isCompanyAdmin", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, id, "companyId", "roleId", "isCompanyAdmin", "isActive", now(), now()
FROM "aibpo_users";

-- 2) 補上 FK 跟索引（風格比照這個 schema 既有的其他 FK：ON DELETE RESTRICT）
ALTER TABLE "aibpo_company_memberships"
  ADD CONSTRAINT "aibpo_company_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aibpo_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aibpo_company_memberships"
  ADD CONSTRAINT "aibpo_company_memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "aibpo_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aibpo_company_memberships"
  ADD CONSTRAINT "aibpo_company_memberships_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "aibpo_company_memberships_userId_companyId_key" ON "aibpo_company_memberships"("userId", "companyId");
CREATE INDEX "aibpo_company_memberships_companyId_idx" ON "aibpo_company_memberships"("companyId");
CREATE INDEX "aibpo_company_memberships_roleId_idx" ON "aibpo_company_memberships"("roleId");

-- 3) 套用前後可以核對：這兩個數字要相等
--   SELECT count(*) FROM aibpo_company_memberships;
--   SELECT count(*) FROM aibpo_users;

-- 4) 砍掉 aibpo_users 上舊的 FK/索引，再砍欄位
ALTER TABLE "aibpo_users" DROP CONSTRAINT IF EXISTS "aibpo_users_roleId_fkey";
ALTER TABLE "aibpo_users" DROP CONSTRAINT IF EXISTS "aibpo_users_companyId_fkey";
DROP INDEX IF EXISTS "aibpo_users_roleId_idx";
DROP INDEX IF EXISTS "aibpo_users_companyId_idx";
ALTER TABLE "aibpo_users"
  DROP COLUMN "companyId",
  DROP COLUMN "roleId",
  DROP COLUMN "isCompanyAdmin",
  DROP COLUMN "isActive";
