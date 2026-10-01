-- AlterTable
ALTER TABLE "aibpo_kb_versions" ADD COLUMN     "backendKnowledgeIds" JSONB,
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "runIndex" INTEGER,
ADD COLUMN     "scoreAll" INTEGER,
ADD COLUMN     "scoreOriginal" INTEGER,
ADD COLUMN     "scoreSimilar" INTEGER;

-- AlterTable
ALTER TABLE "aibpo_version_test_results" ADD COLUMN     "jobQuestionId" TEXT;

-- CreateTable
CREATE TABLE "aibpo_optimization_jobs" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SOURCE',
    "sourceId" TEXT,
    "entryIds" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "contentKind" TEXT NOT NULL,
    "questionSource" TEXT NOT NULL,
    "maxRuns" INTEGER NOT NULL,
    "targetScore" INTEGER NOT NULL,
    "similarCount" INTEGER NOT NULL,
    "stallRuns" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "currentRun" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "resumeStep" TEXT NOT NULL DEFAULT 'PREPARE',
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "stopReason" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_optimization_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_optimization_questions" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "isSimilar" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aibpo_optimization_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_optimization_jobs_roleId_idx" ON "aibpo_optimization_jobs"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_optimization_jobs_sourceId_idx" ON "aibpo_optimization_jobs"("sourceId");

-- CreateIndex
CREATE INDEX "aibpo_optimization_questions_jobId_idx" ON "aibpo_optimization_questions"("jobId");

-- CreateIndex
CREATE INDEX "aibpo_kb_versions_jobId_idx" ON "aibpo_kb_versions"("jobId");

-- CreateIndex
CREATE INDEX "aibpo_version_test_results_jobQuestionId_idx" ON "aibpo_version_test_results"("jobQuestionId");

-- AddForeignKey
ALTER TABLE "aibpo_kb_versions" ADD CONSTRAINT "aibpo_kb_versions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "aibpo_optimization_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_version_test_results" ADD CONSTRAINT "aibpo_version_test_results_jobQuestionId_fkey" FOREIGN KEY ("jobQuestionId") REFERENCES "aibpo_optimization_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_optimization_jobs" ADD CONSTRAINT "aibpo_optimization_jobs_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_optimization_jobs" ADD CONSTRAINT "aibpo_optimization_jobs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "aibpo_km_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_optimization_questions" ADD CONSTRAINT "aibpo_optimization_questions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "aibpo_optimization_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
