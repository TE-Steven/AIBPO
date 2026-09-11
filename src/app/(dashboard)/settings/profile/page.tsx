import { requireSession } from "@/lib/session";
import { DisplayNameForm, ChangePasswordForm } from "./ProfileForms";

export default async function ProfilePage() {
  const session = await requireSession();

  if (session.kind === "superadmin") {
    return (
      <div className="animate-fade-in space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">個人設定</h1>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          超級管理員的帳號密碼是由 Render 服務的環境變數（SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD）控制，
          請至 Render 後台修改，這裡無法異動。
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">個人設定</h1>
        <p className="mt-1 text-sm text-slate-500">
          帳號：{session.username}・角色：{session.roleName}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">顯示名稱</h2>
        <DisplayNameForm defaultValue={session.displayName} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">修改密碼</h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
