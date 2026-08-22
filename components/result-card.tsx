"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis";
import type { SemanticTone } from "@/lib/design-tokens";
import { WatchButton } from "./watch-button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";

// Canonical obligation shape returned by the API (WT-4). Kept structural here
// so the client stays decoupled from Prisma types.
export interface CanonicalObligation {
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
  verification: "certain" | "conditional" | "hypothetical";
  confidence: number | null;
  status: string;
  facts?: { label: string; value: string; quote: string }[];
}

const KIND_LABEL: Record<string, string> = {
  price_increase: "Price increase",
  subscription: "Subscription",
  trial: "Free trial",
  cancellation: "Cancellation / refund",
  none: "No risk found",
};

const KIND_TONE: Record<string, SemanticTone> = {
  price_increase: "alert",
  subscription: "warn",
  trial: "warn",
  cancellation: "save",
  none: "neutral",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  certain: "Certain",
  conditional: "Watch item",
  hypothetical: "Possible",
};

// ConfidenceChip per DESIGN_LANGUAGE.md §6.5: solid (certain),
// outline (conditional), dashed (hypothetical). Never a bare percentage.
const CONFIDENCE_VARIANT = {
  certain: "solid",
  conditional: "outline",
  hypothetical: "dashed",
} as const;

function formatCents(cents: number | null): string | null {
  if (cents === null) return null;
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function ResultCard({
  result,
  obligation,
}: {
  result: AnalysisResult;
  obligation?: CanonicalObligation | null;
}) {
  const [showEvidence, setShowEvidence] = useState(true);

  const exposureRange = (() => {
    if (
      (obligation?.exposureLowCents ?? null) !== null &&
      (obligation?.exposureHighCents ?? null) !== null
    ) {
      const low = formatCents(obligation!.exposureLowCents);
      const high = formatCents(obligation!.exposureHighCents);
      if (low && high && low !== high) return `${low} – ${high}`;
    }
    if (result.exposureLowCentsPerYear !== null && result.exposureHighCentsPerYear !== null) {
      const low = formatCents(result.exposureLowCentsPerYear);
      const high = formatCents(result.exposureHighCentsPerYear);
      if (low && high && low !== high) return `${low} – ${high}`;
    }
    return result.exposureLabel;
  })();

  const facts = obligation?.facts?.length ? obligation.facts : result.facts;

  return (
    <Card hero className="mx-auto max-w-2xl overflow-hidden" testId="result-card">
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={KIND_TONE[result.kind] ?? "neutral"} testId="kind-badge">
            {KIND_LABEL[result.kind] ?? result.kind}
          </Badge>
          <Badge
            variant={CONFIDENCE_VARIANT[result.confidence] ?? "outline"}
            testId="confidence-chip"
          >
            {CONFIDENCE_LABEL[result.confidence]}
          </Badge>
        </div>

        <h2 className="mt-4 text-xl font-semibold text-(--wt-ink-900)" data-testid="result-title">
          {result.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-(--wt-ink-700)" data-testid="result-why">
          {result.whyItMatters}
        </p>

        {/* Exposure block */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-(--wt-save-100) p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-(--wt-ink-500)">
              Potential exposure
            </p>
            <p className="money mt-1 text-2xl font-bold text-(--wt-ink-900)" data-testid="exposure">
              {exposureRange}
            </p>
            {result.exposureAssumption && (
              <p className="mt-1 text-xs text-(--wt-ink-500)" data-testid="exposure-assumption">
                {result.exposureAssumption}
              </p>
            )}
          </div>
          <div className="rounded-lg bg-(--wt-warn-100) p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-(--wt-ink-500)">
              Key deadline
            </p>
            <p className="mt-1 text-2xl font-bold text-(--wt-ink-900)" data-testid="deadline">
              {result.deadline ?? "Not found"}
            </p>
          </div>
        </div>

        {/* Recommendation */}
        <div className="mt-5 rounded-lg border border-(--wt-ink-300) p-4" data-testid="recommendation">
          <p className="text-xs font-medium uppercase tracking-wide text-(--wt-ink-500)">
            Recommended action
          </p>
          <p className="mt-1 text-sm text-(--wt-ink-900)">{result.recommendation}</p>
        </div>

        {/* Watch CTA — only when there's a durable obligation to persist (WT-5) */}
        {obligation?.id && result.kind !== "none" && (
          <div className="mt-5" data-testid="watch-cta">
            <WatchButton obligationId={obligation.id} />
          </div>
        )}

        {/* Evidence panel */}
        <button
          type="button"
          onClick={() => setShowEvidence((s) => !s)}
          className="mt-4 text-sm font-medium text-(--wt-guardian-600) hover:underline"
          data-testid="evidence-toggle"
        >
          {showEvidence ? "Hide what we read" : "Show what we read"}
        </button>
        {showEvidence && (
          <ul className="mt-3 space-y-2 rounded-lg bg-(--wt-paper-50) p-4" data-testid="evidence-list">
            {facts.length === 0 ? (
              <li className="text-sm text-(--wt-ink-500)">No facts extracted from this document.</li>
            ) : (
              facts.map((f, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold text-(--wt-ink-700)">{f.label}:</span>{" "}
                  <span className="text-(--wt-ink-900)">{f.value}</span>
                  {"quote" in f && f.quote ? (
                    <span className="ml-2 font-mono text-xs text-(--wt-ink-500)" title={f.quote}>
                      “{f.quote.slice(0, 60)}…”
                    </span>
                  ) : "source" in f && f.source ? (
                    <span className="ml-2 font-mono text-xs text-(--wt-ink-500)" title={f.source}>
                      “{f.source.slice(0, 60)}…”
                    </span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}
