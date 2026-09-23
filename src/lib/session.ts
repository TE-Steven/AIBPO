import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, SUPER_ADMIN_SUBJECT, verifySessionToken } from "@/lib/auth";
import { ACTIVE_COMPANY_COOKIE_NAME, pickActiveMembership } from "@/lib/activeCompany";

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
      companyId: string;
      companyName: string;
      isCompanyAdmin: boolean;
      menuKeys: string[];
      memberships: { companyId: string; companyName: string; roleName: string; isCompanyAdmin: boolean }[];
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
    include: {
      memberships: {
        where: { isActive: true },
        include: { company: true, role: { include: { roleMenus: { include: { menu: true } } } } },
      },
    },
  });
  // 帳號被刪除，或者在所有公司底下都被停用了，舊 session token 應該立即失效。
  if (!user) return null;

  const activeCompanyId = store.get(ACTIVE_COMPANY_COOKIE_NAME)?.value;
  const active = pickActiveMembership(user.memberships, activeCompanyId);
  if (!active) return null;

  return {
    kind: "user",
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roleId: active.roleId,
    roleName: active.role.name,
    companyId: active.companyId,
    companyName: active.company.name,
    isCompanyAdmin: active.isCompanyAdmin,
    menuKeys: active.role.roleMenus.map((rm) => rm.menu.key),
    memberships: user.memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      roleName: m.role.name,
      isCompanyAdmin: m.isCompanyAdmin,
    })),
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

/** 公司管理員專屬頁面（帳號/角色/Prompt 準則管理）用：非公司管理員一律導去「個人設定」。 */
export async function requireCompanyAdmin(): Promise<Session & { kind: "user"; isCompanyAdmin: true }> {
  const session = await requireSession();
  if (session.kind !== "user" || !session.isCompanyAdmin) redirect("/settings/profile");
  return session as Session & { kind: "user"; isCompanyAdmin: true };
}

/**
 * 建立租戶業務資料（Tally/Dimension/KmSource/Skill/Agent/AgentDraft）的流程專用：
 * 超級管理員不屬於任何公司，不該再靠「隨便挑一個角色」猜要掛在哪間公司底下，直接導去平台總覽頁。
 */
export async function requireCompanyUser(): Promise<Session & { kind: "user" }> {
  const session = await requireSession();
  if (session.kind !== "user") redirect("/platform/companies");
  return session;
}

/** 供 proxy.ts 做路徑層級的選單權限檢查：回傳「目前使用中那間公司」的角色看得到哪些選單路徑，以及是否為公司管理員。 */
export async function getAllowedPathsForUserId(
  userId: string,
  activeCompanyId: string | null,
): Promise<{ allowedPaths: string[]; isCompanyAdmin: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { isActive: true },
        include: { role: { include: { roleMenus: { include: { menu: true } } } } },
      },
    },
  });
  if (!user) return { allowedPaths: [], isCompanyAdmin: false };

  const active = pickActiveMembership(user.memberships, activeCompanyId);
  if (!active) return { allowedPaths: [], isCompanyAdmin: false };

  return {
    allowedPaths: active.role.roleMenus.map((rm) => rm.menu.path),
    isCompanyAdmin: active.isCompanyAdmin,
  };
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
