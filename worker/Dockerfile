# 自動化管理的瀏覽器 Worker（Render Background Worker 用）
# Render 設定：Dockerfile Path = ./worker/Dockerfile，Docker Build Context = 專案根目錄（.）
# 基底映像已內含 Chromium 與系統相依套件，版本要跟 package.json 的 playwright-core 一致
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app

# 先裝套件（含 devDependencies：Worker 用 tsx 直接跑 TypeScript、prisma generate 也需要 prisma CLI）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# generate 不連資料庫，但 prisma.config.ts 會讀 DATABASE_URL，給一個假值避免讀不到
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

ENV NODE_ENV=production
CMD ["npx", "tsx", "worker/index.ts"]
