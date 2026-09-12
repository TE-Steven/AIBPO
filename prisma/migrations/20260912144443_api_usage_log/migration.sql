-- CreateTable
CREATE TABLE "aibpo_api_usage_logs" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "roleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aibpo_api_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_api_usage_logs_createdAt_idx" ON "aibpo_api_usage_logs"("createdAt");
