"use client";

import Link from "next/link";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import {
  CATEGORY_BLURBS,
  CATEGORY_LABELS,
  type LedgerCategory,
  type LedgerSummary,
} from "@/lib/ledger-types";

export type { LedgerSummary };

const KIND_LABEL: Record<string, string> = {
  subscription: "Subscription",
  contract: "Contract",
  bill: "Bill",
  refund: "Refund",
  warranty: "Warranty",
  insurance: "Insurance",
  renewal: "Renewal",
  trial: "Free trial",
  other: "Other",
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function categoryTone(cat: LedgerCategory): "save" | "warn" | "neutral" {
  return cat === "recovered" ? "save" : cat === "avoided" ? "warn" : "neutral";
}

export function LedgerView({ user, ledger }: { user: { email: string | null }; ledger: LedgerSummary }) {
  const rows: { cat: LedgerCategory; cents: number; label: string; blurb: string }[] = [
    { cat: "prevented", cents: ledger.preventedCents, label: CATEGORY_LABELS.prevented, blurb: CATEGORY_BLURBS.prevented },
    { cat: "recovered", cents: ledger.recoveredCents, label: CATEGORY_LABELS.recovered, blurb: CATEGORY_BLURBS.recovered },
    { cat: "avoided", cents: ledger.avoidedCents, label: CATEGORY_LABELS.avoided, blurb: CATEGORY_BLURBS.avoided },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--wt-ink-900)">Money protected</h1>
          <p className="mt-1 text-sm text-(--wt-ink-500)">
            {user.email ?? "Signed in"} · every dollar traced to a source obligation
          </p>
        </div>
        <Link
          href="/watchlist"
          className="text-sm font-medium text-(--wt-ink-700) underline-offset-2 hover:underline"
        >
          Back to watchlist
        </Link>
      </header>

      <Card className="mt-8 p-6" testId="ledger-total-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-(--wt-ink-500)">
              Total protected this year
            </p>
            <p className="money mt-1 text-4xl font-bold text-(--wt-ink-900)" data-testid="ledger-total">
              {formatCents(ledger.totalCents)}
            </p>
          </div>
          <Badge tone="save" variant="solid">
            {ledger.count} {ledger.count === 1 ? "entry" : "entries"}
          </Badge>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {rows.map((r) => (
            <div
              key={r.cat}
              className="rounded-xl border border-(--wt-ink-300) bg-(--wt-paper-50) p-4"
              data-testid={`ledger-category-${r.cat}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-(--wt-ink-900)">{r.label}</span>
                <Badge tone={categoryTone(r.cat)} variant="outline">
                  {r.cat}
                </Badge>
              </div>
              <p className="money mt-2 text-xl font-bold text-(--wt-ink-900)">
                {formatCents(r.cents)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-(--wt-ink-500)">{r.blurb}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-(--wt-ink-500)">
          “Prevented” is a projection of cost avoided — never counted as recovered. Only
          dollars traceable to a verified obligation event are included.
        </p>
      </Card>

      {ledger.entries.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            title="No protected money yet — resolve a watched obligation to record it."
            action={
              <Link href="/watchlist" className="text-sm font-medium text-(--wt-ink-700) hover:underline">
                Go to your watchlist
              </Link>
            }
            testId="ledger-empty"
          />
        </div>
      ) : (
        <ul className="mt-8 space-y-4" data-testid="ledger-list">
          {ledger.entries.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-(--wt-ink-300) bg-(--wt-paper-0) p-5"
              data-testid="ledger-entry"
              data-entry-id={e.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={categoryTone(e.category)} variant="solid">
                      {CATEGORY_LABELS[e.category]}
                    </Badge>
                    {e.verification === "pending" && (
                      <Badge tone="neutral" variant="dashed">
                        pending verification
                      </Badge>
                    )}
                    {e.obligation.kind && (
                      <Badge tone="neutral" variant="outline">
                        {KIND_LABEL[e.obligation.kind] ?? e.obligation.kind}
                      </Badge>
                    )}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-(--wt-ink-900)">
                    {e.obligation.counterpartyName ?? "Unknown provider"}
                  </h3>
                  <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-(--wt-ink-500)">Amount</dt>
                      <dd className="money mt-0.5 font-semibold text-(--wt-ink-900)">
                        {formatCents(e.amountCents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-(--wt-ink-500)">Recorded</dt>
                      <dd className="mt-0.5 font-semibold text-(--wt-ink-900">
                        {formatDate(e.recordedAt)}
                      </dd>
                    </div>
                  </dl>
                  {e.note && (
                    <p className="mt-3 rounded-lg bg-(--wt-paper-50) px-3 py-2 text-sm text-(--wt-ink-700)">
                      {e.note}
                    </p>
                  )}
                  {e.obligation.exposureAssumption && (
                    <p className="mt-2 text-xs text-(--wt-ink-500)">
                      {e.obligation.exposureAssumption}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
