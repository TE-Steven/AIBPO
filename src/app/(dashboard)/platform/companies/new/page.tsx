import { requireSuperAdmin } from "@/lib/session";
import { CreateCompanyForm } from "./CreateCompanyForm";

export default async function NewCompanyPage() {
  await requireSuperAdmin();

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">新增公司</h1>
        <p className="mt-1 text-sm text-slate-500">
          代客戶開通新公司：會建立公司、預設「管理者」角色（含全選單權限），以及第一個公司管理員帳號。
          建立後請自行透過其他管道把帳號密碼告訴客戶。
        </p>
      </div>

      <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <CreateCompanyForm />
      </div>
    </div>
  );
}
