"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 分析中每 4 秒更新一次畫面
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
