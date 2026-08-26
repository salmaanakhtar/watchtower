"use client";

import { useState } from "react";
import Link from "next/link";
import { InputZone, type Phase } from "./input-zone";
import { ResultCard, type CanonicalObligation } from "./result-card";
import { useVariant } from "./variant-provider";
import { BrandMark } from "./ui/brand-mark";
import { Button } from "./ui/button";
import type { ToolDefinition } from "@/lib/tools";
import type { AnalysisResult } from "@/lib/analysis";

/**
 * WT-15: a vertical SEO tool page — a thin wrapper over the analyzer pipeline.
 * Renders the tool's positioning copy + the shared input zone preseeded with
 * the tool's example document, then the result card + repeat CTA.
 */
export function ToolPage({ tool }: { tool: ToolDefinition }) {
  const { variant } = useVariant();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [obligation, setObligation] = useState<CanonicalObligation | null>(null);
  const [resetKey, setResetKey] = useState(0);

  void variant;

  function reset() {
    setPhase("idle");
    setResult(null);
    setObligation(null);
    setResetKey((k) => k + 1);
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-lg font-semibold text-(--wt-ink-900)">Watchtower</span>
        </div>
        <Link
          href="/"
          className="text-sm font-medium text-(--wt-guardian-600) hover:underline"
          data-testid="tool-home-link"
        >
          Full analyzer
        </Link>
      </header>

      <section className="flex flex-col items-center px-6 pt-10 text-center sm:pt-14">
        <span
          className="rounded-full bg-(--wt-guardian-100) px-4 py-1.5 text-xs font-semibold text-(--wt-guardian-700)"
          data-testid="tool-badge"
        >
          {tool.badge}
        </span>
        <h1
          className="mt-6 max-w-2xl text-4xl font-bold leading-tight tracking-tight text-(--wt-ink-900) sm:text-5xl"
          data-testid="tool-headline"
        >
          {tool.headline}
        </h1>
        <p
          className="mt-4 max-w-xl text-base leading-relaxed text-(--wt-ink-500) sm:text-lg"
          data-testid="tool-subheadline"
        >
          {tool.subheadline}
        </p>

        <div className="mt-10 w-full">
          <InputZone
            key={resetKey}
            phase={phase}
            onPhase={setPhase}
            onResult={setResult}
            onObligation={setObligation}
            tool={tool.slug}
            defaultSample={tool.sampleText}
          />
        </div>

        {phase === "done" && result && (
          <div className="mt-8 w-full space-y-6 pb-8">
            <ResultCard result={result} obligation={obligation} />
            <div className="mx-auto max-w-2xl">
              <Button type="button" variant="secondary" onClick={reset} data-testid="check-another-button">
                Check another document free
              </Button>
            </div>
          </div>
        )}
      </section>

      <footer className="mt-auto px-6 py-8 text-center text-xs text-(--wt-ink-500)">
        Watchtower — {tool.name} is free. Your documents are never stored permanently.
      </footer>
    </main>
  );
}
