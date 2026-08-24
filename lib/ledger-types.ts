// WT-13: client-safe ledger constants + types (no db imports — this module is
// bundled into client components). Category definitions mirror lib/ledger.ts.

export const LEDGER_CATEGORIES = ["prevented", "recovered", "avoided"] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

export interface LedgerSummary {
  totalCents: number;
  currency: string;
  preventedCents: number;
  recoveredCents: number;
  avoidedCents: number;
  count: number;
  entries: LedgerEntryView[];
}

export interface LedgerEntryView {
  id: string;
  category: LedgerCategory;
  amountCents: number;
  currency: string;
  note: string | null;
  source: string;
  verification: string;
  recordedAt: string; // ISO
  obligation: {
    id: string;
    kind: string | null;
    counterpartyName: string | null;
    exposureAssumption: string | null;
    exposureLowCents: number | null;
    exposureHighCents: number | null;
  };
}

export const CATEGORY_LABELS: Record<LedgerCategory, string> = {
  prevented: "Prevented",
  recovered: "Recovered",
  avoided: "Avoided",
};

export const CATEGORY_BLURBS: Record<LedgerCategory, string> = {
  prevented:
    "Projected cost you avoided by acting before a charge or deadline. A projection, not money received.",
  recovered: "Money actually returned — refunds, credits, or corrected charges you got back.",
  avoided: "A price increase or incorrect charge stopped on the current bill.",
};
