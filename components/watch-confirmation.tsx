"use client";

import Link from "next/link";

export interface WatchConfirmationObligation {
  id: string;
  kind: string;
  counterpartyName: string | null;
  amountCents: number | null;
  currency: string;
  interval: string | null;
  riskType: string | null;
  exposureLowCents: number | null;
  exposureHighCents: number | null;
  exposureAssumption: string | null;
  verification: string;
  confidence: number | null;
}

function formatCents(cents: number | null): string | null {
  if (cents === null) return null;
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function WatchConfirmation({
  watchItemId,
  obligation,
}: {
  watchItemId: string;
  obligation: WatchConfirmationObligation;
}) {
  const low = formatCents(obligation.exposureLowCents);
  const high = formatCents(obligation.exposureHighCents);
  const exposure = low && high && low !== high ? `${low} – ${high}` : low ?? "—";

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12 text-center">
      <div
        className="rounded-xl border border-(--wt-save-100) bg-(--wt-save-100)/40 p-8"
        data-testid="watch-confirmation"
      >
        <p className="text-4xl">✓</p>
        <h1 className="mt-4 text-2xl font-bold text-(--wt-ink-900)">
          We&apos;re watching {obligation.counterpartyName ?? "this"} for you
        </h1>
        <p className="mt-2 text-sm text-(--wt-ink-700)">
          {obligation.exposureAssumption ?? `Potential exposure ${exposure}`} — we&apos;ll
          remind you before the deadline.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/watchlist"
            className="rounded-lg bg-(--wt-guardian-600) px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--wt-guardian-700)"
            data-testid="view-watchlist"
          >
            View my watchlist
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-(--wt-ink-300) px-5 py-2.5 text-sm font-medium text-(--wt-ink-700) transition-colors hover:border-(--wt-guardian-600) hover:text-(--wt-guardian-600)"
          >
            Analyze another document
          </Link>
        </div>
        <p className="mt-6 text-xs text-(--wt-ink-500)" data-testid="watch-item-ref">
          Watch item {watchItemId}
        </p>
      </div>
    </main>
  );
}
