-- AlterTable
ALTER TABLE "aibpo_kb_versions" ADD COLUMN     "faqItems" JSONB;

-- AlterTable
ALTER TABLE "aibpo_optimization_jobs" ADD COLUMN     "faqSimilarCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "optimizeType" TEXT NOT NULL DEFAULT 'RAG';
