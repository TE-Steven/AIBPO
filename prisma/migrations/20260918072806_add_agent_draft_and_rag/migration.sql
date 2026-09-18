-- AlterTable
ALTER TABLE "aibpo_km_sources" ADD COLUMN     "ragContent" TEXT,
ADD COLUMN     "ragErrorMessage" TEXT,
ADD COLUMN     "ragStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "workflowErrorMessage" TEXT,
ADD COLUMN     "workflowStatus" TEXT NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "aibpo_agent_drafts" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "suggestedName" TEXT NOT NULL,
    "suggestedPrompt" TEXT NOT NULL,
    "suggestedSkillIds" JSONB NOT NULL,
    "unmatchedNote" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAgentId" TEXT,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_agent_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_agent_drafts_sourceId_idx" ON "aibpo_agent_drafts"("sourceId");

-- CreateIndex
CREATE INDEX "aibpo_agent_drafts_roleId_idx" ON "aibpo_agent_drafts"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_agent_drafts_confirmed_idx" ON "aibpo_agent_drafts"("confirmed");

-- AddForeignKey
ALTER TABLE "aibpo_agent_drafts" ADD CONSTRAINT "aibpo_agent_drafts_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "aibpo_km_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_agent_drafts" ADD CONSTRAINT "aibpo_agent_drafts_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_agent_drafts" ADD CONSTRAINT "aibpo_agent_drafts_confirmedAgentId_fkey" FOREIGN KEY ("confirmedAgentId") REFERENCES "aibpo_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
