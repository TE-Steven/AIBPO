-- CreateTable
CREATE TABLE "aibpo_bot_test_runs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_bot_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_bot_test_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "chatId" TEXT,
    "botAnswer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_bot_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_bot_test_runs_sourceId_idx" ON "aibpo_bot_test_runs"("sourceId");

-- CreateIndex
CREATE INDEX "aibpo_bot_test_runs_roleId_idx" ON "aibpo_bot_test_runs"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_bot_test_results_runId_idx" ON "aibpo_bot_test_results"("runId");

-- AddForeignKey
ALTER TABLE "aibpo_bot_test_runs" ADD CONSTRAINT "aibpo_bot_test_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "aibpo_km_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_bot_test_runs" ADD CONSTRAINT "aibpo_bot_test_runs_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_bot_test_results" ADD CONSTRAINT "aibpo_bot_test_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "aibpo_bot_test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
