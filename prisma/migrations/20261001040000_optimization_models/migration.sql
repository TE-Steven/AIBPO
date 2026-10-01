-- AlterTable
ALTER TABLE "aibpo_optimization_jobs" ADD COLUMN     "judgeModel" TEXT NOT NULL DEFAULT 'claude-sonnet-5',
ADD COLUMN     "reviseModel" TEXT NOT NULL DEFAULT 'claude-sonnet-5',
ADD COLUMN     "similarModel" TEXT NOT NULL DEFAULT 'claude-sonnet-5';
