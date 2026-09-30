-- CreateTable
CREATE TABLE "aibpo_kb_versions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_kb_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_test_cases" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "entryId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_version_test_runs" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_version_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_version_test_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "testCaseId" TEXT,
    "order" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "chatId" TEXT,
    "botAnswer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "judgeVerdict" TEXT,
    "judgeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_version_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_kb_versions_roleId_idx" ON "aibpo_kb_versions"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_test_cases_roleId_idx" ON "aibpo_test_cases"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_version_test_runs_versionId_idx" ON "aibpo_version_test_runs"("versionId");

-- CreateIndex
CREATE INDEX "aibpo_version_test_runs_roleId_idx" ON "aibpo_version_test_runs"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_version_test_results_runId_idx" ON "aibpo_version_test_results"("runId");

-- CreateIndex
CREATE INDEX "aibpo_version_test_results_testCaseId_idx" ON "aibpo_version_test_results"("testCaseId");

-- AddForeignKey
ALTER TABLE "aibpo_kb_versions" ADD CONSTRAINT "aibpo_kb_versions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_test_cases" ADD CONSTRAINT "aibpo_test_cases_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_version_test_runs" ADD CONSTRAINT "aibpo_version_test_runs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "aibpo_kb_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_version_test_runs" ADD CONSTRAINT "aibpo_version_test_runs_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_version_test_results" ADD CONSTRAINT "aibpo_version_test_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "aibpo_version_test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_version_test_results" ADD CONSTRAINT "aibpo_version_test_results_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "aibpo_test_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
