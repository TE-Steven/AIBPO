"use client";

import { useState } from "react";
import { SkillForm, type SkillInitialValues } from "./SkillForm";
import { SkillDraftChat } from "./SkillDraftChat";
import type { SkillDraftFields } from "@/lib/skillChat";

function draftToInitialValues(draft: SkillDraftFields): SkillInitialValues {
  return {
    name: draft.name ?? "",
    description: draft.description ?? "",
    method: draft.method ?? "GET",
    urlTemplate: draft.urlTemplate ?? "",
    authType: draft.authType ?? "NONE",
    authConfig: draft.authConfig,
    headers: draft.headers,
    bodyTemplate: "",
    paramsSchema: draft.paramsSchema,
  };
}

export function SkillCreatePanel() {
  const [tab, setTab] = useState<"manual" | "chat">("manual");
  const [initialValues, setInitialValues] = useState<SkillInitialValues | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);

  function handleApply(draft: SkillDraftFields) {
    setInitialValues(draftToInitialValues(draft));
    setFormKey((k) => k + 1);
    setTab("manual");
  }

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            tab === "manual" ? "bg-white text-teal-700 shadow-sm" : "text-slate-500"
          }`}
        >
          手動填寫
        </button>
        <button
          type="button"
          onClick={() => setTab("chat")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            tab === "chat" ? "bg-white text-teal-700 shadow-sm" : "text-slate-500"
          }`}
        >
          用說的建立
        </button>
      </div>

      {tab === "manual" ? <SkillForm key={formKey} initialValues={initialValues} /> : <SkillDraftChat onApply={handleApply} />}
    </div>
  );
}
