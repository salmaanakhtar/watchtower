"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "./ui/badge";
import { Button, buttonClasses } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { StatusChip } from "./ui/status-chip";

export interface WatchlistItem {
  id: string;
  status: "open" | "upcoming" | "due" | "resolved" | "dismissed";
  userNote: string | null;
  deadlineLabel: string | null;
  obligation: {
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
  };
}

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

function formatCents(cents: number | null): string | null {
  if (cents === null) return null;
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function WatchlistView({
  user,
  items,
}: {
  user: { id: string; email: string | null };
  items: WatchlistItem[];
}) {
  const [list, setList] = useState<WatchlistItem[]>(items);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function update(id: string, patch: { status?: string; note?: string | null }) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/watch/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      const json = await res.json();
      const updated = json.watchItem as {
        id: string;
        status: string;
        userNote: string | null;
      };
      setList((prev) =>
        prev.map((w) =>
          w.id === updated.id
            ? { ...w, status: updated.status as WatchlistItem["status"], userNote: updated.userNote }
            : w,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--wt-ink-900)">Your watchlist</h1>
          <p className="mt-1 text-sm text-(--wt-ink-500)">
            {user.email ?? "Signed in"} · {list.length}{" "}
            {list.length === 1 ? "item" : "items"} being watched
          </p>
        </div>
        <Link href="/" className={buttonClasses("secondary")} data-testid="analyze-more">
          Analyze another document
        </Link>
      </header>

      {list.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            title="Nothing watched yet — upload your first bill."
            action={
              <Link href="/" className={buttonClasses()}>
                Analyze a document
              </Link>
            }
            testId="watchlist-empty"
          />
        </div>
      ) : (
        <ul className="mt-8 space-y-4" data-testid="watchlist">
          {list.map((w) => {
            const low = formatCents(w.obligation.exposureLowCents);
            const high = formatCents(w.obligation.exposureHighCents);
            const exposure =
              low && high && low !== high ? `${low} – ${high}` : low ?? "—";
            return (
              <li
                key={w.id}
                className="rounded-xl border border-(--wt-ink-300) bg-(--wt-paper-0) p-5"
                data-testid="watchlist-item"
                data-item-id={w.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip status={w.status} testId="status-chip" />
                      <Badge tone="neutral" variant="outline">
                        {KIND_LABEL[w.obligation.kind] ?? w.obligation.kind}
                      </Badge>
                      {w.obligation.verification && (
                        <Badge tone="neutral" variant="dashed">
                          {w.obligation.verification}
                        </Badge>
                      )}
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-(--wt-ink-900)">
                      {w.obligation.counterpartyName ?? "Unknown provider"}
                    </h3>
                    <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-(--wt-ink-500)">
                          Key deadline
                        </dt>
                        <dd className="mt-0.5 font-semibold text-(--wt-ink-900)">
                          {w.deadlineLabel ?? "Not found"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-(--wt-ink-500)">
                          Potential exposure
                        </dt>
                        <dd className="money mt-0.5 font-semibold text-(--wt-ink-900)">
                          {exposure}
                        </dd>
                        {w.obligation.exposureAssumption && (
                          <dd className="mt-0.5 text-xs text-(--wt-ink-500)">
                            {w.obligation.exposureAssumption}
                          </dd>
                        )}
                      </div>
                    </dl>
                    {w.userNote && (
                      <p
                        className="mt-3 rounded-lg bg-(--wt-paper-50) px-3 py-2 text-sm text-(--wt-ink-700)"
                        data-testid="watch-note"
                      >
                        Note: {w.userNote}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Button
                      type="button"
                      variant="success"
                      disabled={busyId === w.id}
                      onClick={() => update(w.id, { status: "resolved" })}
                      className="px-3 py-1.5 text-xs"
                      data-testid="resolve-button"
                    >
                      Mark resolved
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busyId === w.id}
                      onClick={() => update(w.id, { status: "dismissed" })}
                      className="px-3 py-1.5 text-xs font-medium"
                      data-testid="dismiss-button"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
