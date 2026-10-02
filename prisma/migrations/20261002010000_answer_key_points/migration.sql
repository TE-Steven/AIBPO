-- AlterTable
ALTER TABLE "aibpo_bot_test_results" ADD COLUMN     "judgeDetail" JSONB;

-- AlterTable
ALTER TABLE "aibpo_kb_versions" ADD COLUMN     "scoreCoverage" INTEGER;

-- AlterTable
ALTER TABLE "aibpo_version_test_results" ADD COLUMN     "judgeDetail" JSONB;

-- CreateTable
CREATE TABLE "aibpo_answer_key_points" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_answer_key_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aibpo_answer_key_points_roleId_answerHash_key" ON "aibpo_answer_key_points"("roleId", "answerHash");

-- AddForeignKey
ALTER TABLE "aibpo_answer_key_points" ADD CONSTRAINT "aibpo_answer_key_points_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
