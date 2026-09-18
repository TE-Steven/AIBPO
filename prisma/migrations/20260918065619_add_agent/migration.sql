-- CreateTable
CREATE TABLE "aibpo_agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "roleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_agent_skills" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aibpo_agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_agents_roleId_idx" ON "aibpo_agents"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_agent_skills_agentId_idx" ON "aibpo_agent_skills"("agentId");

-- CreateIndex
CREATE INDEX "aibpo_agent_skills_skillId_idx" ON "aibpo_agent_skills"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "aibpo_agent_skills_agentId_skillId_key" ON "aibpo_agent_skills"("agentId", "skillId");

-- AddForeignKey
ALTER TABLE "aibpo_agents" ADD CONSTRAINT "aibpo_agents_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_agent_skills" ADD CONSTRAINT "aibpo_agent_skills_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "aibpo_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_agent_skills" ADD CONSTRAINT "aibpo_agent_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "aibpo_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
