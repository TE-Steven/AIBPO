-- CreateTable
CREATE TABLE "aibpo_tallies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_tallies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_dimensions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aibpo_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_km_sources" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "rawText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "roleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_km_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_km_entries" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tallyId" TEXT,
    "dimensionsUsed" JSONB,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_km_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aibpo_tallies_roleId_idx" ON "aibpo_tallies"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "aibpo_dimensions_roleId_name_key" ON "aibpo_dimensions"("roleId", "name");

-- CreateIndex
CREATE INDEX "aibpo_km_sources_roleId_idx" ON "aibpo_km_sources"("roleId");

-- CreateIndex
CREATE INDEX "aibpo_km_entries_sourceId_idx" ON "aibpo_km_entries"("sourceId");

-- CreateIndex
CREATE INDEX "aibpo_km_entries_roleId_idx" ON "aibpo_km_entries"("roleId");

-- AddForeignKey
ALTER TABLE "aibpo_tallies" ADD CONSTRAINT "aibpo_tallies_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_tallies" ADD CONSTRAINT "aibpo_tallies_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "aibpo_tallies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_dimensions" ADD CONSTRAINT "aibpo_dimensions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_km_sources" ADD CONSTRAINT "aibpo_km_sources_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_km_entries" ADD CONSTRAINT "aibpo_km_entries_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "aibpo_km_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_km_entries" ADD CONSTRAINT "aibpo_km_entries_tallyId_fkey" FOREIGN KEY ("tallyId") REFERENCES "aibpo_tallies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_km_entries" ADD CONSTRAINT "aibpo_km_entries_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
