-- CreateTable
CREATE TABLE "aibpo_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_menus" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aibpo_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aibpo_role_menus" (
    "roleId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,

    CONSTRAINT "aibpo_role_menus_pkey" PRIMARY KEY ("roleId","menuId")
);

-- CreateIndex
CREATE UNIQUE INDEX "aibpo_roles_name_key" ON "aibpo_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "aibpo_users_username_key" ON "aibpo_users"("username");

-- CreateIndex
CREATE INDEX "aibpo_users_roleId_idx" ON "aibpo_users"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "aibpo_menus_key_key" ON "aibpo_menus"("key");

-- AddForeignKey
ALTER TABLE "aibpo_users" ADD CONSTRAINT "aibpo_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_menus" ADD CONSTRAINT "aibpo_menus_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "aibpo_menus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_role_menus" ADD CONSTRAINT "aibpo_role_menus_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "aibpo_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aibpo_role_menus" ADD CONSTRAINT "aibpo_role_menus_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "aibpo_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
