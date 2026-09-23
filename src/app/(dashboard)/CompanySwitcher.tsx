"use client";

import { useRef } from "react";
import { switchCompanyAction } from "./switchCompanyActions";

export function CompanySwitcher({
  currentCompanyId,
  memberships,
}: {
  currentCompanyId: string;
  memberships: { companyId: string; companyName: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={switchCompanyAction}>
      <select
        name="companyId"
        defaultValue={currentCompanyId}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-white/30 bg-white/10 px-2 py-1 text-xs font-medium text-white [&>option]:text-slate-800"
      >
        {memberships.map((m) => (
          <option key={m.companyId} value={m.companyId}>
            {m.companyName}
          </option>
        ))}
      </select>
    </form>
  );
}
