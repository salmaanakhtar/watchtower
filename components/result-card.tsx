"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis";

const KIND_LABEL: Record<string, string> = {
  price_increase: "Price increase",
  subscription: "Subscription",
  trial: "Free trial",
  cancellation: "Cancellation / refund",
  none: "No risk found",
};

const KIND_COLOR: Record<string, string> = {
  price_increase: "bg-(--wt-alert-100) text-(--wt-alert-600)",
  subscription: "bg-(--wt-warn-100) text-(--wt-warn-600)",
  trial: "bg-(--wt-warn-100) text-(--wt-warn-600)",
  cancellation: "bg-(--wt-save-100) text-(--wt-save-600)",
  none: "bg-(--wt-ink-300)/30 text-(--wt-ink-500)",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  certain: "Certain",
  conditional: "Watch item",
  hypothetical: "Possible",
};

export function ResultCard({ result }: { result: AnalysisResult }) {
  const [showEvidence, setShowEvidence] = useState(true);

  return (
    <div
      className="w-full max-w-2xl mx-auto rounded-xl bg-(--wt-paper-0) border border-(--wt-ink-300) shadow-sm overflow-hidden"
      data-testid="result-card"
    >
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${KIND_COLOR[result.kind] ?? "bg-(--wt-ink-300)/30 text-(--wt-ink-500)"}`}
            data-testid="kind-badge"
          >
            {KIND_LABEL[result.kind] ?? result.kind}
          </span>
          <span
            className="rounded-full border border-(--wt-ink-300) px-3 py-1 text-xs font-medium text-(--wt-ink-500)"
            data-testid="confidence-chip"
          >
            {CONFIDENCE_LABEL[result.confidence]}
          </span>
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
              {result.exposureLabel}
            </p>
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
            {result.facts.length === 0 ? (
              <li className="text-sm text-(--wt-ink-500)">No facts extracted from this document.</li>
            ) : (
              result.facts.map((f, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold text-(--wt-ink-700)">{f.label}:</span>{" "}
                  <span className="text-(--wt-ink-900)">{f.value}</span>
                  <span className="ml-2 font-mono text-xs text-(--wt-ink-500)" title={f.source}>
                    “{f.source.slice(0, 60)}…”
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
