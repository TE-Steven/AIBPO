-- CreateTable
CREATE TABLE "aibpo_system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_system_settings_pkey" PRIMARY KEY ("key")
);
