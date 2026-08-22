import type { ReactNode } from "react";
import type { SemanticTone } from "@/lib/design-tokens";

// Chips/badges per DESIGN_LANGUAGE.md §6.5: solid / outline / dashed variants,
// pill radius. Color is always paired with a text label — never color alone.
export type BadgeVariant = "solid" | "outline" | "dashed";

const TONE_CLASSES: Record<SemanticTone, { solid: string; soft: string }> = {
  guardian: {
    solid: "bg-(--wt-guardian-600) text-white border-transparent",
    soft: "bg-(--wt-guardian-100) text-(--wt-guardian-700) border-transparent",
  },
  save: {
    solid: "bg-(--wt-save-600) text-white border-transparent",
    soft: "bg-(--wt-save-100) text-(--wt-save-600) border-transparent",
  },
  warn: {
    solid: "bg-(--wt-warn-600) text-white border-transparent",
    soft: "bg-(--wt-warn-100) text-(--wt-warn-600) border-transparent",
  },
  alert: {
    solid: "bg-(--wt-alert-600) text-white border-transparent",
    soft: "bg-(--wt-alert-100) text-(--wt-alert-600) border-transparent",
  },
  neutral: {
    solid: "bg-(--wt-neutral-500) text-white border-transparent",
    soft: "bg-(--wt-ink-300)/30 text-(--wt-ink-500) border-transparent",
  },
};

export interface BadgeProps {
  children: ReactNode;
  tone?: SemanticTone;
  variant?: BadgeVariant;
  className?: string;
  testId?: string;
}

export function Badge({
  children,
  tone = "neutral",
  variant = "solid",
  className,
  testId,
}: BadgeProps) {
  const base =
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors duration-(--wt-duration-fast)";
  const style =
    variant === "solid"
      ? TONE_CLASSES[tone].soft
      : `border bg-transparent text-(--wt-ink-500) ${
          variant === "dashed" ? "border-dashed" : ""
        }border-(--wt-ink-300)`;
  return (
    <span className={`${base} ${style}${className ? ` ${className}` : ""}`} data-testid={testId}>
      {children}
    </span>
  );
}
