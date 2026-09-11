import { requireSession } from "@/lib/session";
import { IconDashboard } from "@/components/icons";

export default async function DashboardHomePage() {
  const session = await requireSession();

  const displayName = session.displayName;
  const roleLabel = session.kind === "superadmin" ? "超級管理員" : session.roleName;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">歡迎回來，{displayName}</h1>
        <p className="mt-1 text-sm text-slate-500">目前身分：{roleLabel}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <IconDashboard className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">這是 AIBPO 後台首頁</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              左側選單依你的角色權限顯示，可到「個人設定」修改密碼與顯示名稱。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
