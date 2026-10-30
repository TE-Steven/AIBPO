import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildIslandSnapshot } from "@/lib/platformIsland";

export const dynamic = "force-dynamic";

// 營運島的資料快照：只有平台超級管理員可以讀（proxy 對 /api 不擋，這裡自己檢查）
export async function GET() {
  const session = await getSession();
  if (session?.kind !== "superadmin") return NextResponse.json({ error: "只有平台超級管理員可以查看。" }, { status: 403 });
  return NextResponse.json(await buildIslandSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
