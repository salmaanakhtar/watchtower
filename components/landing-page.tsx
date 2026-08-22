"use client";

import { useState } from "react";
import { InputZone, type Phase } from "./input-zone";
import { ResultCard, type CanonicalObligation } from "./result-card";
import { WaitlistForm } from "./waitlist-form";
import { useVariant } from "./variant-provider";
import type { AnalysisResult } from "@/lib/analysis";

function BrandMark() {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-(--wt-guardian-600) text-white">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M12 4c-4 0-7 3-7 8v2l-1 3h16l-1-3v-2c0-5-3-8-7-8Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="13" r="1.6" fill="currentColor" />
      </svg>
    </span>
  );
}

export function LandingPage() {
  const { variant, copy } = useVariant();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [obligation, setObligation] = useState<CanonicalObligation | null>(null);

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-lg font-semibold text-(--wt-ink-900)">Watchtower</span>
        </div>
        <span
          className="rounded-full border border-(--wt-ink-300) px-3 py-1 text-xs font-medium text-(--wt-ink-500)"
          data-testid="variant-badge"
        >
          Variant {variant}
        </span>
      </header>

      <section className="flex flex-col items-center px-6 pt-10 text-center sm:pt-16">
        <span
          className="rounded-full bg-(--wt-guardian-100) px-4 py-1.5 text-xs font-semibold text-(--wt-guardian-700)"
          data-testid="badge"
        >
          {copy.badge}
        </span>
        <h1
          className="mt-6 max-w-2xl text-4xl font-bold leading-tight tracking-tight text-(--wt-ink-900) sm:text-5xl"
          data-testid="headline"
        >
          {copy.headline}
        </h1>
        <p
          className="mt-4 max-w-xl text-base leading-relaxed text-(--wt-ink-500) sm:text-lg"
          data-testid="subheadline"
        >
          {copy.subheadline}
        </p>

        <div className="mt-10 w-full">
          <InputZone phase={phase} onPhase={setPhase} onResult={setResult} onObligation={setObligation} />
        </div>

        {phase === "done" && result && (
          <div className="mt-8 w-full space-y-6 pb-8">
            <ResultCard result={result} obligation={obligation} />
            <WaitlistForm />
          </div>
        )}
      </section>

      <footer className="mt-auto px-6 py-8 text-center text-xs text-(--wt-ink-500)">
        Watchtower — early access. Your documents are never stored permanently.
      </footer>
    </main>
  );
}
