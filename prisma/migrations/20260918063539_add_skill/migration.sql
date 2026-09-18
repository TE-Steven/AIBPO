-- CreateTable
CREATE TABLE "aibpo_skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "urlTemplate" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'NONE',
    "authConfig" JSONB,
    "headers" JSONB,
    "bodyTemplate" TEXT,
    "paramsSchema" JSONB NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_skills_roleId_idx" ON "aibpo_skills"("roleId");

-- AddForeignKey
ALTER TABLE "aibpo_skills" ADD CONSTRAINT "aibpo_skills_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
