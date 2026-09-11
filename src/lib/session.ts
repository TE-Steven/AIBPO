import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, SUPER_ADMIN_SUBJECT, verifySessionToken } from "@/lib/auth";

export type Session =
  | {
      kind: "superadmin";
      displayName: string;
      menuKeys: null; // null 代表不限制，看得到全部選單
    }
  | {
      kind: "user";
      id: string;
      username: string;
      displayName: string;
      roleId: string;
      roleName: string;
      menuKeys: string[];
    };

/** 讀取並驗證目前登入者的 session；superadmin 是環境變數帳號，不查資料庫。 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const subject = verifySessionToken(token);
  if (!subject) return null;

  if (subject === SUPER_ADMIN_SUBJECT) {
    return { kind: "superadmin", displayName: "超級管理員", menuKeys: null };
  }

  const user = await prisma.user.findUnique({
    where: { id: subject },
    include: { role: { include: { roleMenus: { include: { menu: true } } } } },
  });
  // 帳號被停用或刪除後，舊 session token 應該立即失效。
  if (!user || !user.isActive) return null;

  return {
    kind: "user",
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roleId: user.roleId,
    roleName: user.role.name,
    menuKeys: user.role.roleMenus.map((rm) => rm.menu.key),
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireSuperAdmin(): Promise<Session & { kind: "superadmin" }> {
  const session = await requireSession();
  // 導去「個人設定」而不是「/」：一般使用者的角色不一定看得到「/」，避免導成迴圈。
  if (session.kind !== "superadmin") redirect("/settings/profile");
  return session;
}

/** 供 proxy.ts 做路徑層級的選單權限檢查：回傳這個使用者的角色看得到哪些選單路徑。 */
export async function getAllowedPathsForUserId(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { roleMenus: { include: { menu: true } } } } },
  });
  if (!user || !user.isActive) return [];
  return user.role.roleMenus.map((rm) => rm.menu.path);
}

export function canSeeMenu(session: Session, menuKey: string): boolean {
  return session.menuKeys === null || session.menuKeys.includes(menuKey);
}

/**
 * 資料權限用：套進 Prisma where 條件，限制只能看到「同角色」的資料列。
 * superadmin 回傳空物件（不加限制，全部看得到）。
 */
export function roleScope(session: Session): { roleId?: string } {
  return session.kind === "superadmin" ? {} : { roleId: session.roleId };
}
