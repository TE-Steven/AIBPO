import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { deleteTallyAction } from "./actions";
import { CreateTallyForm } from "./TallyForms";
import { IconMenuList, IconTrash } from "@/components/icons";

type TallyRow = { id: string; name: string; parentId: string | null; order: number };
type TallyNode<T extends TallyRow> = T & { depth: number; children: TallyNode<T>[] };

function buildTree<T extends TallyRow>(tallies: T[]): TallyNode<T>[] {
  const byParent = new Map<string | null, T[]>();
  for (const t of tallies) {
    const arr = byParent.get(t.parentId) ?? [];
    arr.push(t);
    byParent.set(t.parentId, arr);
  }
  function build(parentId: string | null, depth: number): TallyNode<T>[] {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return children.map((t) => ({ ...t, depth, children: build(t.id, depth + 1) }));
  }
  return build(null, 1);
}

function flatten<T extends TallyRow>(nodes: TallyNode<T>[]): TallyNode<T>[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

export default async function TallyPage() {
  const session = await requireSession();

  const tallies = await prisma.tally.findMany({
    where: roleScope(session),
    include: { _count: { select: { children: true, kmEntries: true } } },
    orderBy: { order: "asc" },
  });

  const tree = buildTree(tallies);
  const flatList = flatten(tree);
  // 只有第 1、2 層可以再往下掛子分類（最多三層）。
  const parentOptions = flatList
    .filter((t) => t.depth < 3)
    .map((t) => ({ id: t.id, label: `${"　".repeat(t.depth - 1)}${t.depth > 1 ? "└ " : ""}${t.name}` }));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">分類管理（Tally）</h1>
        <p className="mt-1 text-sm text-slate-500">
          大中小分類，最多三層，也可以只用大分類。分類可以在「來源管理」時當作分析維度使用。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">新增分類</h2>
        <CreateTallyForm parentOptions={parentOptions} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-5 py-3">分類</th>
              <th className="px-5 py-3">層級</th>
              <th className="px-5 py-3">使用中的 KM 數</th>
              <th className="px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {flatList.map((t) => {
              const deletable = t._count.children === 0 && t._count.kmEntries === 0;
              return (
                <tr key={t.id}>
                  <td
                    className="flex items-center gap-2.5 px-5 py-3 font-medium text-slate-800"
                    style={{ paddingLeft: `${1.25 + (t.depth - 1) * 1.5}rem` }}
                  >
                    {t.depth > 1 && <span className="text-slate-300">└</span>}
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                      <IconMenuList className="h-3.5 w-3.5" />
                    </span>
                    {t.name}
                  </td>
                  <td className="px-5 py-3 text-slate-500">第 {t.depth} 層</td>
                  <td className="px-5 py-3 text-slate-500">{t._count.kmEntries}</td>
                  <td className="px-5 py-3">
                    {deletable ? (
                      <form action={deleteTallyAction.bind(null, t.id)}>
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                          刪除
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-slate-300">尚有子分類或 KM 使用中</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {flatList.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">
                  尚未建立任何分類
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
