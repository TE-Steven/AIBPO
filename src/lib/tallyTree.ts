// 分類（Tally）是 parentId 串起來的樹，最多三層。這裡放「平面清單 → 樹」與範本判斷，分類管理頁與 KM 分析共用。

export type TallyRow = { id: string; name: string; parentId: string | null; order: number };
export type TallyNode<T extends TallyRow> = T & { depth: number; children: TallyNode<T>[] };

export function buildTallyTree<T extends TallyRow>(tallies: T[]): TallyNode<T>[] {
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

export function flattenTallyTree<T extends TallyRow>(nodes: TallyNode<T>[]): TallyNode<T>[] {
  return nodes.flatMap((n) => [n, ...flattenTallyTree(n.children)]);
}

// 每個分類的完整路徑（大 > 中 > 小），給 AI 替 FAQ 歸類用：不同分支底下的同名分類（例如兩個範本都有「價格」）靠路徑區分。
export function tallyPathOptions<T extends TallyRow>(tallies: T[]): { id: string; path: string }[] {
  const options: { id: string; path: string }[] = [];
  function walk(nodes: TallyNode<T>[], prefix: string) {
    for (const n of nodes) {
      const path = prefix ? `${prefix} > ${n.name}` : n.name;
      options.push({ id: n.id, path });
      walk(n.children, path);
    }
  }
  walk(buildTallyTree(tallies), "");
  return options;
}

// AI 建議的分類 → 分類 id：先比完整路徑；AI 只回名稱時，名稱唯一才採用（同名有好幾個就不猜）。
export function resolveTallyId(options: { id: string; path: string }[], suggested: string | null): string | null {
  if (!suggested) return null;
  const normalized = suggested.replace(/[＞›»]/g, ">").replace(/\s*>\s*/g, " > ").trim();
  const exact = options.find((o) => o.path === normalized);
  if (exact) return exact.id;
  const byName = options.filter((o) => o.path.split(" > ").pop() === normalized);
  return byName.length === 1 ? byName[0].id : null;
}

// 文件範本：底下有子分類的第一層分類。第一層 = 一種實體（例如「產品型號」），第二層 = 維度，第三層 = 子維度。
export function tallyTemplates<T extends TallyRow>(tree: TallyNode<T>[]): TallyNode<T>[] {
  return tree.filter((n) => n.children.length > 0);
}
