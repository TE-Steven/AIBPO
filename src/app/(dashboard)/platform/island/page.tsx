import { requireSuperAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

// 營運島：六角小島拼成的 3D 營運總覽（public/platform-island.html，單一 HTML＋CDN Three.js），資料來自 /api/platform/island
export default async function PlatformIslandPage() {
  await requireSuperAdmin();
  return (
    // 撐滿右側內容區：跳出 layout 的 max-w-6xl 與內距（側欄寬 16rem，lg 以下側欄隱藏）
    <div className="relative left-1/2 -my-6 w-screen -translate-x-1/2 lg:-my-8 lg:w-[calc(100vw-16rem)]">
      <iframe
        src="/platform-island.html"
        title="AIBPO 營運島"
        className="block h-[calc(100vh-3.5rem)] w-full border-0"
      />
    </div>
  );
}
