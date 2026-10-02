"use client";

import { useState } from "react";
import { KnowledgeList } from "./KnowledgeList";
import { VersionsPanel } from "./VersionsPanel";
import type { BotOption } from "@/lib/botTest";
import { TestBankPanel } from "./TestBankPanel";
import { ComparePanel } from "./ComparePanel";
import type { TestCaseView, VersionView } from "./knowledgeTypes";

type Tab = "entries" | "versions" | "tests" | "compare";

// 知識列表頁的四個分頁：題目（原本的列表）→ 建立版本 → 用固定題庫測試 → 版本比較
export function KnowledgeWorkspace({
  listProps,
  versions,
  testCases,
  bots,
}: {
  listProps: Omit<React.ComponentProps<typeof KnowledgeList>, "onVersionCreated">;
  versions: VersionView[];
  testCases: TestCaseView[];
  bots: BotOption[];
}) {
  const [tab, setTab] = useState<Tab>("entries");
  const [compareFocus, setCompareFocus] = useState<{ ids: string[]; nonce: number }>({ ids: [], nonce: 0 });
  const activeTestCount = testCases.filter((t) => !t.archived).length;

  const tabs: { id: Tab; label: string }[] = [
    { id: "entries", label: `題目（${listProps.entries.length}）` },
    { id: "versions", label: `版本（${versions.length}）` },
    { id: "tests", label: `測試題庫（${activeTestCount}）` },
    { id: "compare", label: "版本比較" },
  ];

  function viewResults(versionId: string) {
    // 從版本卡片點正確率：比較這一版與它前一個測過的版本
    const tested = versions.filter((v) => v.latestRun).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const idx = tested.findIndex((v) => v.id === versionId);
    const ids = idx > 0 ? [tested[idx - 1].id, versionId] : [versionId];
    setCompareFocus((prev) => ({ ids, nonce: prev.nonce + 1 }));
    setTab("compare");
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.id ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "entries" && <KnowledgeList {...listProps} onVersionCreated={() => setTab("versions")} />}
      {tab === "versions" && (
        <VersionsPanel versions={versions} testCaseCount={activeTestCount} bots={bots} onViewResults={viewResults} />
      )}
      {tab === "tests" && <TestBankPanel testCases={testCases} versions={versions} />}
      {tab === "compare" && <ComparePanel key={compareFocus.nonce} versions={versions} initialSelected={compareFocus.ids} />}
    </div>
  );
}
