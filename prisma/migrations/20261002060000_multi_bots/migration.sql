-- AlterTable
ALTER TABLE "aibpo_bot_test_runs" ADD COLUMN     "botId" TEXT,
ADD COLUMN     "botName" TEXT;

-- AlterTable
ALTER TABLE "aibpo_version_test_runs" ADD COLUMN     "botId" TEXT,
ADD COLUMN     "botName" TEXT;

-- AlterTable
ALTER TABLE "aibpo_optimization_jobs" ADD COLUMN     "botId" TEXT,
ADD COLUMN     "botName" TEXT;
