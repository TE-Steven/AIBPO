import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, SUPER_ADMIN_SUBJECT, verifySessionToken } from "@/lib/auth";
import { getAllowedPathsForUserId } from "@/lib/session";

// 一般使用者不管選單權限勾了什麼，這幾頁一律進不去（帳號/角色/選單管理是超級管理員專屬功能）。
const SUPER_ADMIN_ONLY_PREFIXES = ["/settings/users", "/settings/roles", "/settings/menus"];
// 任何已登入的人都看得到，不受選單權限矩陣影響。
const ALWAYS_ALLOWED_PATHS = ["/settings/profile"];

function isUnderPath(pathname: string, target: string) {
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
    return NextResponse.next();
  }

  // 以下只套用在一般使用者：選單權限在這裡做成真正的路徑保護，不是只有側欄看不看得到而已。
  if (SUPER_ADMIN_ONLY_PREFIXES.some((p) => isUnderPath(pathname, p))) {
    return NextResponse.redirect(new URL("/settings/profile", request.url));
  }
  if (ALWAYS_ALLOWED_PATHS.some((p) => isUnderPath(pathname, p))) {
    return NextResponse.next();
  }

  const allowedPaths = await getAllowedPathsForUserId(subject);
  const permitted = allowedPaths.some((p) => isUnderPath(pathname, p));
  if (!permitted) {
    return NextResponse.redirect(new URL("/settings/profile", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
