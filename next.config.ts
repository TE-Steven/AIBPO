import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 預設 1MB 太小，上傳多個 PDF 建立來源時很容易超過，導致 Server Action 直接失敗變成一片空白的錯誤頁。
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
