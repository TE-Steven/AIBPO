import Link from "next/link";
import { loginAction } from "./actions";
import { Logo } from "@/components/Logo";
import { IconAlertTriangle } from "@/components/icons";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo subtitle="後台管理登入" />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold text-slate-900">歡迎回來</h1>
          <p className="mb-6 text-sm text-slate-500">請輸入帳號密碼登入後台</p>

          {error && (
            <p className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-600 ring-1 ring-inset ring-rose-100">
              <IconAlertTriangle className="h-4 w-4 shrink-0" />
              帳號或密碼錯誤，請再試一次。
            </p>
          )}

          <form action={loginAction} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">帳號</label>
              <input
                name="username"
                type="text"
                required
                autoFocus
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">密碼</label>
              <input
                name="password"
                type="password"
                required
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm transition focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600"
            >
              登入
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-400">
            還沒有公司帳號？{" "}
            <Link href="/signup" className="font-medium text-teal-600 hover:text-teal-700">
              註冊新公司
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
