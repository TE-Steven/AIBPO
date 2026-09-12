-- AlterTable
ALTER TABLE "aibpo_km_entries" ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "aibpo_km_entries_confirmed_idx" ON "aibpo_km_entries"("confirmed");
