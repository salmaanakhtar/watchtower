// WT-15: acquisition experiments — free vertical SEO tools.
//
// Each tool is a thin wrapper over the existing analyzer pipeline with
// positioning copy + a preseeded example that matches the tool's promise
// (MARKETING_DISTRIBUTION.md §"Channel 2 — Free vertical tools / SEO",
// PHASE0_1_PLAN.md §9.2). Tools are SEO entry points that feed the same
// watchlist/account system; every interaction is funnel-instrumented
// (ExperimentEvent rows) so each tool's traffic → analysis → result → account
// conversion is measurable end-to-end.

export const TOOL_SLUGS = [
  "contract-renewal-analyzer",
  "cancellation-deadline-checker",
] as const;

export type ToolSlug = (typeof TOOL_SLUGS)[number];

export interface ToolDefinition {
  slug: ToolSlug;
  name: string;
  shortName: string;
  headline: string;
  subheadline: string;
  /** Preseeded example document that demonstrates the tool's promise. */
  sampleText: string;
  /** SEO metadata (landing meta title/description + JSON-LD). */
  metaTitle: string;
  metaDescription: string;
  badge: string;
}

export const TOOLS: Record<ToolSlug, ToolDefinition> = {
  "contract-renewal-analyzer": {
    slug: "contract-renewal-analyzer",
    name: "Contract Renewal Analyzer",
    shortName: "Renewal analyzer",
    headline: "Will your contract auto-renew and cost you more?",
    subheadline:
      "Paste a contract, service agreement, or renewal notice. Watchtower finds the renewal date, the price you'd pay, and whether you can still cancel.",
    sampleText:
      "Your annual support contract with Atlas Software renews automatically on October 1 at $1,200 per year. This is an increase from your current $960 per year. To cancel, you must notify us at least 30 days before the renewal date.",
    metaTitle: "Contract Renewal Analyzer — find auto-renewals before they cost you",
    metaDescription:
      "Free contract renewal analyzer. Paste your contract or renewal notice and see the renewal date, the new price, and whether you can still cancel.",
    badge: "Free contract checker",
  },
  "cancellation-deadline-checker": {
    slug: "cancellation-deadline-checker",
    name: "Cancellation Deadline Checker",
    shortName: "Deadline checker",
    headline: "Is it too late to cancel? Check the deadline.",
    subheadline:
      "Paste the cancellation email or terms. Watchtower tells you the deadline to cancel before the next charge — and whether you still have time.",
    sampleText:
      "Your gym membership at Ironworks Fitness will renew on the 1st of November at $39.99 per month. You can cancel any time before November 1 by replying to this email with the word CANCEL.",
    metaTitle: "Cancellation Deadline Checker — did you miss the cut-off?",
    metaDescription:
      "Free cancellation deadline checker. Paste a cancellation notice and find out the last day to cancel before the next charge.",
    badge: "Free deadline checker",
  },
};

export function getTool(slug: string | null | undefined): ToolDefinition | null {
  if (!slug) return null;
  return TOOLS[slug as ToolSlug] ?? null;
}

export function isValidToolSlug(slug: string): slug is ToolSlug {
  return slug in TOOLS;
}

export function allTools(): ToolDefinition[] {
  return Object.values(TOOLS);
}
