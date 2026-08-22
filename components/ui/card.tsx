import type { ReactNode } from "react";

// Surface card per DESIGN_LANGUAGE.md §5/§9: paper-0 on ink-300 border.
// 8px radius by default; `hero` bumps to the 12px hero radius (§5).
export function Card({
  children,
  className,
  hero,
  testId,
}: {
  children: ReactNode;
  className?: string;
  hero?: boolean;
  testId?: string;
}) {
  const radius = hero ? "rounded-xl" : "rounded-lg";
  return (
    <div
      className={`w-full border border-(--wt-ink-300) bg-(--wt-paper-0) shadow-sm ${radius}${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
