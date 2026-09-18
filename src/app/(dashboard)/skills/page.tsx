import Link from "next/link";
import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { deleteSkillAction } from "./actions";
import { SkillForm } from "./SkillForm";
import { IconWrench, IconTrash, IconPencil } from "@/components/icons";

const AUTH_LABEL: Record<string, string> = {
  NONE: "無",
  BEARER: "Bearer Token",
  API_KEY_HEADER: "API Key",
  BASIC: "Basic Auth",
};

export default async function SkillsPage() {
  const session = await requireSession();

  const skills = await prisma.skill.findMany({
    where: roleScope(session),
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Skill 管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          定義可重複使用的 API 呼叫工具，之後可以在 Agent 畫布上拖曳組裝，讓 AI 依對話內容自主決定何時呼叫。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">新增 Skill</h2>
        <SkillForm />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">名稱</th>
              <th className="px-5 py-3">方法 / URL</th>
              <th className="px-5 py-3">認證</th>
              <th className="px-5 py-3">參數數量</th>
              <th className="px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {skills.map((s) => (
              <tr key={s.id}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5 font-medium text-slate-800">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                      <IconWrench className="h-3.5 w-3.5" />
                    </span>
                    {s.name}
                  </div>
                  <p className="ml-9.5 mt-0.5 max-w-sm truncate text-xs text-slate-400">{s.description}</p>
                </td>
                <td className="px-5 py-3 text-slate-500">
                  <span className="font-mono text-xs">{s.method}</span> <span className="max-w-xs truncate">{s.urlTemplate}</span>
                </td>
                <td className="px-5 py-3 text-slate-500">{AUTH_LABEL[s.authType] ?? s.authType}</td>
                <td className="px-5 py-3 text-slate-500">{Array.isArray(s.paramsSchema) ? s.paramsSchema.length : 0}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/skills/${s.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
                    >
                      <IconPencil className="h-3.5 w-3.5" />
                      編輯
                    </Link>
                    <form action={deleteSkillAction.bind(null, s.id)}>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                        刪除
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {skills.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">
                  尚未建立任何 Skill
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
