-- AlterTable
ALTER TABLE "aibpo_bot_test_results" ADD COLUMN     "entryId" TEXT;

-- CreateIndex
CREATE INDEX "aibpo_bot_test_results_entryId_idx" ON "aibpo_bot_test_results"("entryId");

-- AddForeignKey
ALTER TABLE "aibpo_bot_test_results" ADD CONSTRAINT "aibpo_bot_test_results_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "aibpo_km_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 回填既有測試結果對應的題目：先用題目文字完全相同的對上
UPDATE "aibpo_bot_test_results" AS res
SET "entryId" = e."id"
FROM "aibpo_bot_test_runs" AS run, "aibpo_km_entries" AS e
WHERE res."runId" = run."id"
  AND e."sourceId" = run."sourceId"
  AND e."question" = res."question"
  AND res."entryId" IS NULL;

-- 題目已被改過的，用建立順序對上（測試建立時就是依題目 createdAt 排序編號）
UPDATE "aibpo_bot_test_results" AS res
SET "entryId" = ranked."id"
FROM "aibpo_bot_test_runs" AS run,
     (SELECT "id", "sourceId", ROW_NUMBER() OVER (PARTITION BY "sourceId" ORDER BY "createdAt") AS rn
      FROM "aibpo_km_entries") AS ranked
WHERE res."runId" = run."id"
  AND ranked."sourceId" = run."sourceId"
  AND ranked.rn = res."order"
  AND res."entryId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "aibpo_bot_test_results" AS other
    WHERE other."runId" = res."runId" AND other."entryId" = ranked."id"
  );
