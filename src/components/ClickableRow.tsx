"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

export function ClickableRow({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();

  function handleClick(e: MouseEvent<HTMLTableRowElement>) {
    if ((e.target as HTMLElement).closest("a, button")) return;
    router.push(href);
  }

  return (
    <tr onClick={handleClick} className={className}>
      {children}
    </tr>
  );
}
