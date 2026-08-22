"use client";

import { useState } from "react";
import Link from "next/link";

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

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  upcoming: "Upcoming",
  due: "Due",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-(--wt-warn-100) text-(--wt-warn-600)",
  upcoming: "bg-(--wt-warn-100) text-(--wt-warn-600)",
  due: "bg-(--wt-alert-100) text-(--wt-alert-600)",
  resolved: "bg-(--wt-save-100) text-(--wt-save-600)",
  dismissed: "bg-(--wt-ink-300)/30 text-(--wt-ink-500)",
};

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
        <Link
          href="/"
          className="rounded-lg border border-(--wt-ink-300) px-3 py-1.5 text-sm font-medium text-(--wt-ink-700) transition-colors hover:border-(--wt-guardian-600) hover:text-(--wt-guardian-600)"
          data-testid="analyze-more"
        >
          Analyze another document
        </Link>
      </header>

      {list.length === 0 ? (
        <div
          className="mt-10 rounded-xl border border-dashed border-(--wt-ink-300) bg-(--wt-paper-0) p-10 text-center"
          data-testid="watchlist-empty"
        >
          <p className="text-lg font-semibold text-(--wt-ink-900)">
            Nothing watched yet — upload your first bill.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-(--wt-guardian-600) px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--wt-guardian-700)"
          >
            Analyze a document
          </Link>
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
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLOR[w.status] ?? "bg-(--wt-ink-300)/30 text-(--wt-ink-500)"}`}
                        data-testid="status-chip"
                      >
                        {STATUS_LABEL[w.status] ?? w.status}
                      </span>
                      <span className="rounded-full border border-(--wt-ink-300) px-3 py-1 text-xs font-medium text-(--wt-ink-500)">
                        {KIND_LABEL[w.obligation.kind] ?? w.obligation.kind}
                      </span>
                      {w.obligation.verification && (
                        <span className="rounded-full border border-dashed border-(--wt-ink-300) px-3 py-1 text-xs font-medium text-(--wt-ink-500)">
                          {w.obligation.verification}
                        </span>
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
                    <button
                      type="button"
                      disabled={busyId === w.id}
                      onClick={() => update(w.id, { status: "resolved" })}
                      className="rounded-lg bg-(--wt-save-600) px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-(--wt-save-600)/80 disabled:opacity-50"
                      data-testid="resolve-button"
                    >
                      Mark resolved
                    </button>
                    <button
                      type="button"
                      disabled={busyId === w.id}
                      onClick={() => update(w.id, { status: "dismissed" })}
                      className="rounded-lg border border-(--wt-ink-300) px-3 py-1.5 text-xs font-medium text-(--wt-ink-700) transition-colors hover:border-(--wt-alert-600) hover:text-(--wt-alert-600) disabled:opacity-50"
                      data-testid="dismiss-button"
                    >
                      Dismiss
                    </button>
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
