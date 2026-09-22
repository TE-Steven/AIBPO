import { Logo } from "@/components/Logo";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo subtitle="註冊新公司" />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold text-slate-900">建立你的公司</h1>
          <p className="mb-6 text-sm text-slate-500">
            填完就會自動建立公司管理員帳號並直接登入，不需要等人工開通。
          </p>
          <SignupForm />
        </div>
      </div>
    </div>
  );
}
