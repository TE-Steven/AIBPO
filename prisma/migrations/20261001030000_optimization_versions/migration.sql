-- AlterTable
ALTER TABLE "aibpo_optimization_jobs" ADD COLUMN     "baseVersionId" TEXT,
ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0;

-- 既有任務依建立時間補上流水號
UPDATE "aibpo_optimization_jobs" j SET "seq" = r.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "roleId" ORDER BY "createdAt") AS rn FROM "aibpo_optimization_jobs") r
WHERE j."id" = r."id";
