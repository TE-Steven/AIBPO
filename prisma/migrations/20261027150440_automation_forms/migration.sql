-- CreateTable
CREATE TABLE "aibpo_automation_forms" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "fields" JSONB,
    "pageInfo" JSONB,
    "screenshot" TEXT,
    "errorMessage" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "authorizedBy" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_automation_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_automation_jobs" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "result" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_automation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_automation_forms_roleId_idx" ON "aibpo_automation_forms"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_automation_jobs_status_createdAt_idx" ON "aibpo_automation_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "aibpo_automation_jobs_formId_idx" ON "aibpo_automation_jobs"("formId");

-- AddForeignKey
ALTER TABLE "aibpo_automation_forms" ADD CONSTRAINT "aibpo_automation_forms_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_automation_jobs" ADD CONSTRAINT "aibpo_automation_jobs_formId_fkey" FOREIGN KEY ("formId") REFERENCES "aibpo_automation_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
