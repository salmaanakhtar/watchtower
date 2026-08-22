import type { ReactNode } from "react";

// EmptyState per DESIGN_LANGUAGE.md §6.10: the watchlist-empty moment —
// quiet, one sentence of copy, one primary action.
export function EmptyState({
  title,
  children,
  action,
  testId,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="w-full rounded-xl border border-dashed border-(--wt-ink-300) bg-(--wt-paper-0) p-10 text-center"
      data-testid={testId}
    >
      <p className="text-lg font-semibold text-(--wt-ink-900)">{title}</p>
      {children && <p className="mt-2 text-sm text-(--wt-ink-500)">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
