-- AlterTable
ALTER TABLE "aibpo_km_sources" ADD COLUMN     "docErrorMessage" TEXT,
ADD COLUMN     "docStartedAt" TIMESTAMP(3),
ADD COLUMN     "docStatus" TEXT NOT NULL DEFAULT 'NONE';

-- 回填：已經有結構化文件的來源標記為已完成
UPDATE "aibpo_km_sources" SET "docStatus" = 'DONE'
WHERE "id" IN (SELECT DISTINCT "sourceId" FROM "aibpo_km_entries" WHERE "kind" = 'DOC');
