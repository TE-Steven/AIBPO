import { requireCompanyUser } from "@/lib/session";
import { IconSparkles } from "@/components/icons";

export const dynamic = "force-dynamic";

// FAQ優化：功能規劃中，先放選單與頁面
export default async function FaqOptimizePage() {
  await requireCompanyUser();
  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">FAQ優化</h1>
        <p className="mt-1 text-sm text-slate-500">針對 FAQ 的自動優化。</p>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600">
          <IconSparkles className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold text-slate-700">功能規劃中</p>
        <p className="text-xs text-slate-500">FAQ優化的功能正在設計，完成後會在這裡開放。</p>
      </div>
    </div>
  );
}
