// 「目前使用中的公司」不是授權依據，只是提示用——真正的授權每次都要對照當事人在資料庫裡
// isActive:true 的 CompanyMembership 重新驗證，所以這個 cookie 不用簽章。

export const ACTIVE_COMPANY_COOKIE_NAME = "aibpo_active_company";

export const ACTIVE_COMPANY_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

type MembershipLike = { companyId: string; createdAt: Date };

/**
 * 從一個人目前有效的 membership 清單裡，挑出「目前使用中」的那一筆。
 * cookie 裡的公司如果沒有/已經失效（例如剛好被停用），退回選最早加入的那間公司，而不是報錯。
 */
export function pickActiveMembership<T extends MembershipLike>(
  memberships: T[],
  activeCompanyId: string | null | undefined,
): T | null {
  if (memberships.length === 0) return null;
  if (activeCompanyId) {
    const match = memberships.find((m) => m.companyId === activeCompanyId);
    if (match) return match;
  }
  return [...memberships].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
}
