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

// 文件範本：底下有子分類的第一層分類。第一層 = 一種實體（例如「產品型號」），第二層 = 維度，第三層 = 子維度。
export function tallyTemplates<T extends TallyRow>(tree: TallyNode<T>[]): TallyNode<T>[] {
  return tree.filter((n) => n.children.length > 0);
}
