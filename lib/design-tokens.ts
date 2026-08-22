// Watchtower design tokens — typed source of truth (DESIGN_LANGUAGE.md §9).
// styles/tokens.css mirrors this file; a unit test enforces parity.

export type TokenMap = Record<string, string>;

export const LIGHT_TOKENS: TokenMap = {
  "--wt-ink-900": "#0f172a",
  "--wt-ink-700": "#334155",
  "--wt-ink-500": "#64748b",
  "--wt-ink-300": "#cbd5e1",
  "--wt-paper-50": "#f8fafc",
  "--wt-paper-0": "#ffffff",
  "--wt-guardian-600": "#0f766e",
  "--wt-guardian-700": "#0d5f59",
  "--wt-guardian-100": "#ccfbf1",
  "--wt-save-600": "#15803d",
  "--wt-save-100": "#dcfce7",
  "--wt-warn-600": "#b45309",
  "--wt-warn-100": "#fef3c7",
  "--wt-alert-600": "#b91c1c",
  "--wt-alert-100": "#fee2e2",
  "--wt-neutral-500": "#64748b",
};

// Dark mode: same hues at adjusted lightness (DESIGN_LANGUAGE.md §3).
export const DARK_TOKENS: TokenMap = {
  "--wt-ink-900": "#f8fafc",
  "--wt-ink-700": "#cbd5e1",
  "--wt-ink-500": "#94a3b8",
  "--wt-ink-300": "#475569",
  "--wt-paper-50": "#0f172a",
  "--wt-paper-0": "#1e293b",
  "--wt-guardian-600": "#14b8a6",
  "--wt-guardian-700": "#2dd4bf",
  "--wt-guardian-100": "#134e4a",
  "--wt-save-600": "#4ade80",
  "--wt-save-100": "#14532d",
  "--wt-warn-600": "#fbbf24",
  "--wt-warn-100": "#78350f",
  "--wt-alert-600": "#f87171",
  "--wt-alert-100": "#7f1d1d",
};

export type SemanticTone = "save" | "warn" | "alert" | "neutral" | "guardian";

export type ConfidenceTier = "certain" | "conditional" | "hypothetical";

// ConfidenceChip styling per DESIGN_LANGUAGE.md §6.5: certain = solid,
// conditional = outline, hypothetical = dashed. Never a bare percentage.
export const CONFIDENCE_VARIANT: Record<ConfidenceTier, "solid" | "outline" | "dashed"> = {
  certain: "solid",
  conditional: "outline",
  hypothetical: "dashed",
};
