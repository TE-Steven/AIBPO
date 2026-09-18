import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { updateSkillAction, type SkillHeader, type SkillParam } from "../actions";
import { SkillForm } from "../SkillForm";
import { IconArrowLeft } from "@/components/icons";

export default async function EditSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const skill = await prisma.skill.findUnique({ where: { id } });
  if (!skill) notFound();
  if (session.kind !== "superadmin" && skill.roleId !== session.roleId) notFound();

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Link href="/skills" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <IconArrowLeft className="h-4 w-4" />
          返回 Skill 管理
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">編輯 Skill</h1>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <SkillForm
          action={updateSkillAction.bind(null, skill.id)}
          submitLabel="儲存變更"
          pendingLabel="儲存中…"
          initialValues={{
            name: skill.name,
            description: skill.description,
            method: skill.method,
            urlTemplate: skill.urlTemplate,
            authType: skill.authType,
            authConfig: skill.authConfig,
            headers: (skill.headers as SkillHeader[] | null) ?? [],
            bodyTemplate: skill.bodyTemplate ?? "",
            paramsSchema: (skill.paramsSchema as SkillParam[] | null) ?? [],
          }}
        />
      </div>
    </div>
  );
}
