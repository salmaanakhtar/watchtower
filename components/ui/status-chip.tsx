import { Badge } from "./badge";
import type { SemanticTone } from "@/lib/design-tokens";

// Watchlist lifecycle per DESIGN_LANGUAGE.md §6.7/6.8: open / upcoming / due /
// resolved / dismissed, with green/amber/red semantics.
export type WatchStatus = "open" | "upcoming" | "due" | "resolved" | "dismissed";

const STATUS_TONE: Record<WatchStatus, { tone: SemanticTone; label: string }> = {
  open: { tone: "warn", label: "Open" },
  upcoming: { tone: "warn", label: "Upcoming" },
  due: { tone: "alert", label: "Due" },
  resolved: { tone: "save", label: "Resolved" },
  dismissed: { tone: "neutral", label: "Dismissed" },
};

export function statusTone(status: string): { tone: SemanticTone; label: string } {
  return STATUS_TONE[status as WatchStatus] ?? { tone: "neutral", label: status };
}

export function StatusChip({
  status,
  testId,
}: {
  status: string;
  testId?: string;
}) {
  const { tone, label } = statusTone(status);
  return (
    <Badge tone={tone} variant="solid" testId={testId}>
      <StatusDot tone={tone} />
      {label}
    </Badge>
  );
}

export function StatusDot({ tone }: { tone: SemanticTone }) {
  const color =
    tone === "save"
      ? "bg-(--wt-save-600)"
      : tone === "warn"
        ? "bg-(--wt-warn-600)"
        : tone === "alert"
          ? "bg-(--wt-alert-600)"
          : tone === "guardian"
            ? "bg-(--wt-guardian-600)"
            : "bg-(--wt-neutral-500)";
  return (
    <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${color}`} />
  );
}
