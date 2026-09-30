import { requireSession, roleScope } from "@/lib/session";
import { prisma } from "@/lib/db";
import { CreateTallyForm, DeleteTallyButton, TallyNameCell } from "./TallyForms";
import { IconMenuList } from "@/components/icons";
import { buildTallyTree, flattenTallyTree } from "@/lib/tallyTree";

export default async function TallyPage() {
  const session = await requireSession();

  const tallies = await prisma.tally.findMany({
    where: roleScope(session),
    include: { _count: { select: { children: true, kmEntries: true } } },
    orderBy: { order: "asc" },
  });

  const tree = buildTallyTree(tallies);
  const flatList = flattenTallyTree(tree);
  // 只有第 1、2 層可以再往下掛子分類（最多三層）。
  const parentOptions = flatList
    .filter((t) => t.depth < 3)
    .map((t) => ({ id: t.id, label: `${"　".repeat(t.depth - 1)}${t.depth > 1 ? "└ " : ""}${t.name}` }));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">分類管理（Tally）</h1>
        <p className="mt-1 text-sm text-slate-500">
          大中小分類，最多三層，也可以只用大分類。分類可以在「來源管理」時當作分析維度使用；
          底下有子分類的大分類會被當成「文件範本」：例如「產品型號」底下有「價格」「規格」，分析時就會找出每個型號，依這些維度各整理成一份結構化文件。
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
              // 刪除的影響範圍：整棵子樹的子分類數，以及子樹裡所有分類的 KM 數
              const subtree = flattenTallyTree([t]);
              const subtreeEntries = subtree.reduce((sum, n) => sum + n._count.kmEntries, 0);
              return (
                <tr key={t.id}>
                  <td className="flex items-start gap-2.5 px-5 py-3" style={{ paddingLeft: `${1.25 + (t.depth - 1) * 1.5}rem` }}>
                    {t.depth > 1 && <span className="pt-1 text-slate-300">└</span>}
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                      <IconMenuList className="h-3.5 w-3.5" />
                    </span>
                    <TallyNameCell tallyId={t.id} name={t.name} description={t.description} />
                  </td>
                  <td className="px-5 py-3 text-slate-500">第 {t.depth} 層</td>
                  <td className="px-5 py-3 text-slate-500">{t._count.kmEntries}</td>
                  <td className="px-5 py-3">
                    <DeleteTallyButton
                      tallyId={t.id}
                      name={t.name}
                      descendantCount={subtree.length - 1}
                      entryCount={subtreeEntries}
                    />
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
