// WT-13: money-protected ledger — the north-star value metric ("money
// protected so far", PRODUCT_BRIEF). Strict category definitions so claims
// stay defensible (PHASE0_1_PLAN §1.2, §8, §10).
//
// Categories:
//   prevented  — projected cost avoided by acting before a charge or deadline
//                (e.g. cancelled before an auto-renewal). This is a
//                COUNTERFACTUAL: the charge never happened, so it is labeled
//                "projected" in the UI and never counted as recovered.
//   recovered  — realized money back (refund, credit, corrected charge).
//                Only dollars the user actually got back are recovered.
//   avoided    — a price increase or incorrect charge stopped (realized on the
//                current bill, distinct from prevented's hypothetical charge).
//
// Every entry is anchored to an obligation (and through it, a document with
// provenance), so each claimed dollar is traceable to a verified event.

import { z } from "zod";
import { db } from "@/lib/db";
import {
  LEDGER_CATEGORIES,
  type LedgerCategory,
  type LedgerSummary,
  type LedgerEntryView,
} from "@/lib/ledger-types";

// Re-export client-safe types/constants so a single import from "@/lib/ledger"
// works for both server logic and (server-side) views.
export { LEDGER_CATEGORIES, CATEGORY_LABELS, CATEGORY_BLURBS } from "@/lib/ledger-types";
export type { LedgerCategory, LedgerSummary, LedgerEntryView } from "@/lib/ledger-types";

/** How much exposure counts toward each category, per obligation kind/risk. */
export function projectedAmountForCategory(
  obligation: {
    kind: string | null;
    riskType: string | null;
    amountCents: number | null;
    exposureLowCents: number | null;
    exposureHighCents: number | null;
  },
  category: LedgerCategory,
): number | null {
  if (category === "prevented") {
    // Conservative projection: the low bound of the exposure when present,
    // else the unit amount. Never the high bound.
    if (obligation.exposureLowCents != null && obligation.exposureLowCents > 0) {
      return obligation.exposureLowCents;
    }
    if (obligation.amountCents != null && obligation.amountCents > 0) {
      return obligation.amountCents;
    }
    return null;
  }
  if (category === "avoided") {
    // A realized price increase / incorrect charge: the unit amount is the
    // realized figure (the charge would have landed on the current bill).
    if (obligation.amountCents != null && obligation.amountCents > 0) {
      return obligation.amountCents;
    }
    if (obligation.exposureLowCents != null && obligation.exposureLowCents > 0) {
      return obligation.exposureLowCents;
    }
    return null;
  }
  // recovered: no amount is knowable from the obligation alone — it must be
  // supplied by the user or the pipeline (a realized refund).
  return null;
}

const entryBodySchema = z.object({
  obligationId: z.string().min(1).max(100),
  category: z.enum(LEDGER_CATEGORIES),
  amountCents: z
    .number()
    .int()
    .positive()
    .max(10_000_000_00), // $10,000,000 — sanity cap, integer cents
  currency: z.string().length(3).default("USD"),
  note: z.string().max(500).optional().nullable(),
  source: z.enum(["manual", "ingest", "admin"]).optional().default("manual"),
  verification: z.enum(["verified", "pending"]).optional().default("verified"),
});

export const ledgerEntryInputSchema = entryBodySchema;
export type LedgerEntryInput = z.input<typeof entryBodySchema>;

/**
 * Record a ledger entry, idempotently: one entry per (user, obligation,
 * category). Returns the created entry, or the existing one on a duplicate
 * (the unique index makes this race-safe).
 */
export async function recordLedgerEntry(
  userId: string,
  input: LedgerEntryInput,
): Promise<{ entry: LedgerEntryView; created: boolean }> {
  const parsed = entryBodySchema.parse(input);
  const existing = await db.ledgerEntry.findUnique({
    where: {
      userId_obligationId_category: {
        userId,
        obligationId: parsed.obligationId,
        category: parsed.category,
      },
    },
    select: {
      id: true,
      category: true,
      amountCents: true,
      currency: true,
      note: true,
      source: true,
      verification: true,
      recordedAt: true,
      obligation: {
        select: {
          id: true,
          kind: true,
          counterpartyName: true,
          exposureAssumption: true,
          exposureLowCents: true,
          exposureHighCents: true,
        },
      },
    },
  });
  if (existing) {
    return { entry: toView(existing), created: false };
  }
  const entry = await db.ledgerEntry.create({
    data: {
      userId,
      obligationId: parsed.obligationId,
      category: parsed.category,
      amountCents: parsed.amountCents,
      currency: parsed.currency,
      note: parsed.note ?? null,
      source: parsed.source,
      verification: parsed.verification,
    },
    select: {
      id: true,
      category: true,
      amountCents: true,
      currency: true,
      note: true,
      source: true,
      verification: true,
      recordedAt: true,
      obligation: {
        select: {
          id: true,
          kind: true,
          counterpartyName: true,
          exposureAssumption: true,
          exposureLowCents: true,
          exposureHighCents: true,
        },
      },
    },
  });
  return { entry: toView(entry), created: true };
}

/** Record a ledger entry derived from an obligation's exposure (prevented). */
export async function recordPreventedFromObligation(
  userId: string,
  obligationId: string,
  note?: string | null,
): Promise<{ entry: LedgerEntryView | null; created: boolean; reason: string }> {
  const obligation = await db.obligation.findFirst({
    where: { id: obligationId, OR: [{ userId }, { watchItems: { some: { userId } } }] },
    select: {
      kind: true,
      riskType: true,
      amountCents: true,
      exposureLowCents: true,
      exposureHighCents: true,
    },
  });
  if (!obligation) return { entry: null, created: false, reason: "not-found" };
  const amountCents = projectedAmountForCategory(obligation, "prevented");
  if (amountCents === null) return { entry: null, created: false, reason: "no-amount" };
  const { entry, created } = await recordLedgerEntry(userId, {
    obligationId,
    category: "prevented",
    amountCents,
    note: note ?? "Marked resolved — projected cost avoided.",
    source: "manual",
    verification: "verified",
  });
  return { entry, created, reason: "ok" };
}

/** Summarize the user's ledger: per-category totals + the entries. */
export async function getLedgerSummary(userId: string): Promise<LedgerSummary> {
  const entries = await db.ledgerEntry.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    select: {
      id: true,
      category: true,
      amountCents: true,
      currency: true,
      note: true,
      source: true,
      verification: true,
      recordedAt: true,
      obligation: {
        select: {
          id: true,
          kind: true,
          counterpartyName: true,
          exposureAssumption: true,
          exposureLowCents: true,
          exposureHighCents: true,
        },
      },
    },
  });

  const views = entries.map(toView);
  const byCategory = (cat: LedgerCategory) =>
    views
      .filter((e) => e.category === cat)
      .reduce((sum, e) => sum + e.amountCents, 0);

  return {
    totalCents: byCategory("prevented") + byCategory("recovered") + byCategory("avoided"),
    currency: views[0]?.currency ?? "USD",
    preventedCents: byCategory("prevented"),
    recoveredCents: byCategory("recovered"),
    avoidedCents: byCategory("avoided"),
    count: views.length,
    entries: views,
  };
}

function toView(e: {
  id: string;
  category: string;
  amountCents: number;
  currency: string;
  note: string | null;
  source: string;
  verification: string;
  recordedAt: Date;
  obligation: {
    id: string;
    kind: string | null;
    counterpartyName: string | null;
    exposureAssumption: string | null;
    exposureLowCents: number | null;
    exposureHighCents: number | null;
  };
}): LedgerEntryView {
  return {
    id: e.id,
    category: e.category as LedgerCategory,
    amountCents: e.amountCents,
    currency: e.currency,
    note: e.note,
    source: e.source,
    verification: e.verification,
    recordedAt: e.recordedAt.toISOString(),
    obligation: {
      id: e.obligation.id,
      kind: e.obligation.kind,
      counterpartyName: e.obligation.counterpartyName,
      exposureAssumption: e.obligation.exposureAssumption,
      exposureLowCents: e.obligation.exposureLowCents,
      exposureHighCents: e.obligation.exposureHighCents,
    },
  };
}
