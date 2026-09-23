import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, SUPER_ADMIN_SUBJECT, verifySessionToken } from "@/lib/auth";
import { getAllowedPathsForUserId } from "@/lib/session";
import { ACTIVE_COMPANY_COOKIE_NAME } from "@/lib/activeCompany";

// 一般使用者不管選單權限勾了什麼，這幾頁一律進不去；選單管理是平台超級管理員專屬（全站共用的功能目錄）。
const PLATFORM_SUPERADMIN_ONLY_PREFIXES = ["/settings/menus"];
// 帳號/角色/Prompt 準則管理：平台超級管理員或「該公司的」公司管理員都能進。
const COMPANY_ADMIN_PREFIXES = ["/settings/users", "/settings/roles", "/settings/prompts"];
// 平台維運頁面：只有平台超級管理員能進，一般使用者/公司管理員都不行。
const PLATFORM_ONLY_PREFIXES = ["/platform"];
// 租戶業務資料頁面：超級管理員完全不碰租戶資料，一律導去平台總覽頁。
const TENANT_ONLY_PREFIXES = ["/", "/team", "/km", "/agents", "/skills"];
// 任何已登入的人都看得到，不受選單權限矩陣影響。
const ALWAYS_ALLOWED_PATHS = ["/settings/profile"];

function isUnderPath(pathname: string, target: string) {
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const subject = verifySessionToken(token);
  if (!subject) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (subject === SUPER_ADMIN_SUBJECT) {
    // 超級管理員是平台維運角色，不碰任何租戶業務資料，統一導去平台總覽頁。
    if (TENANT_ONLY_PREFIXES.some((p) => isUnderPath(pathname, p)) || COMPANY_ADMIN_PREFIXES.some((p) => isUnderPath(pathname, p))) {
      return NextResponse.redirect(new URL("/platform/companies", request.url));
    }
    return NextResponse.next();
  }

  // 以下只套用在一般使用者/公司管理員：選單權限在這裡做成真正的路徑保護，不是只有側欄看不看得到而已。
  if (PLATFORM_SUPERADMIN_ONLY_PREFIXES.some((p) => isUnderPath(pathname, p)) || PLATFORM_ONLY_PREFIXES.some((p) => isUnderPath(pathname, p))) {
    return NextResponse.redirect(new URL("/settings/profile", request.url));
  }
  if (ALWAYS_ALLOWED_PATHS.some((p) => isUnderPath(pathname, p))) {
    return NextResponse.next();
  }

  const activeCompanyId = request.cookies.get(ACTIVE_COMPANY_COOKIE_NAME)?.value ?? null;
  const { allowedPaths, isCompanyAdmin } = await getAllowedPathsForUserId(subject, activeCompanyId);

  if (COMPANY_ADMIN_PREFIXES.some((p) => isUnderPath(pathname, p))) {
    if (!isCompanyAdmin) {
      return NextResponse.redirect(new URL("/settings/profile", request.url));
    }
    return NextResponse.next();
  }

  const permitted = allowedPaths.some((p) => isUnderPath(pathname, p));
  if (!permitted) {
    return NextResponse.redirect(new URL("/settings/profile", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
