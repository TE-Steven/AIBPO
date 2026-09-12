import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { deleteDimensionAction } from "./actions";
import { CreateDimensionForm } from "./DimensionForms";
import { IconShieldCheck, IconTrash } from "@/components/icons";

export default async function DimensionsPage() {
  const session = await requireSession();

  const dimensions = await prisma.dimension.findMany({
    where: roleScope(session),
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">維度管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          常用的分析維度，之後在「新增KM」分析文件時可以重複勾選，也能臨時加自由文字。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">新增維度</h2>
        <CreateDimensionForm />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">維度</th>
              <th className="px-5 py-3">說明</th>
              <th className="px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dimensions.map((d) => (
              <tr key={d.id}>
                <td className="flex items-center gap-2.5 px-5 py-3 font-medium text-slate-800">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                    <IconShieldCheck className="h-3.5 w-3.5" />
                  </span>
                  {d.name}
                </td>
                <td className="px-5 py-3 text-slate-500">{d.description || "—"}</td>
                <td className="px-5 py-3">
                  <form action={deleteDimensionAction.bind(null, d.id)}>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700"
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                      刪除
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {dimensions.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-sm text-slate-400">
                  尚未建立任何維度
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
