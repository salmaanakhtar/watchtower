"use client";

import { useRef, useState } from "react";
import { useVariant } from "./variant-provider";
import { SAMPLE_TEXT } from "@/lib/variants";
import type { AnalysisResult } from "@/lib/analysis";

export type Phase = "idle" | "processing" | "done" | "error";

export function InputZone({
  phase,
  onPhase,
  onResult,
}: {
  phase: Phase;
  onPhase: (p: Phase) => void;
  onResult: (r: AnalysisResult) => void;
}) {
  const { variant } = useVariant();
  const [tab, setTab] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(content: string, kind: "paste" | "file", contentType?: string) {
    setError(null);
    onPhase("processing");
    try {
      const res = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, variant, kind, contentType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed");
      onResult(json.result as AnalysisResult);
      onPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      onPhase("error");
    }
  }

  function handlePaste() {
    if (!text.trim()) {
      setError("Paste the document text first.");
      onPhase("error");
      return;
    }
    void submit(text, "paste");
  }

  function handleFile(file: File) {
    setFileName(file.name);
    // Phase 0: read small text files; PDFs/images are queued for manual review.
    if (file.type.startsWith("text/") || file.type === "application/json") {
      const reader = new FileReader();
      reader.onload = () => void submit(String(reader.result), "file", file.type);
      reader.readAsText(file);
    } else {
      void submit(
        `[File uploaded: ${file.name}] Manual review in progress.`,
        "file",
        file.type,
      );
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto" data-testid="input-zone">
      <div className="rounded-xl bg-(--wt-paper-0) border border-(--wt-ink-300) shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-(--wt-ink-300)">
          <button
            type="button"
            onClick={() => setTab("paste")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === "paste"
                ? "text-(--wt-guardian-600) border-b-2 border-(--wt-guardian-600)"
                : "text-(--wt-ink-500) hover:text-(--wt-ink-700)"
            }`}
            data-testid="tab-paste"
          >
            Paste text
          </button>
          <button
            type="button"
            onClick={() => setTab("file")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === "file"
                ? "text-(--wt-guardian-600) border-b-2 border-(--wt-guardian-600)"
                : "text-(--wt-ink-500) hover:text-(--wt-ink-700)"
            }`}
            data-testid="tab-file"
          >
            Upload PDF / screenshot
          </button>
        </div>

        {/* Body */}
        {phase === "processing" ? (
          <div className="p-8 text-center" data-testid="processing">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-(--wt-ink-300) border-t-(--wt-guardian-600)" />
            <p className="text-sm text-(--wt-ink-700)">Reading document…</p>
            <p className="mt-1 text-xs text-(--wt-ink-500)">Finding dates, amounts, and renewal terms.</p>
          </div>
        ) : tab === "paste" ? (
          <div className="p-4 sm:p-6">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the bill, renewal email, contract, or receipt text here…"
              className="w-full min-h-40 resize-y rounded-lg border border-(--wt-ink-300) bg-(--wt-paper-50) p-3 text-sm outline-none focus:border-(--wt-guardian-600) focus:ring-2 focus:ring-(--wt-guardian-600)/20"
              data-testid="paste-input"
              aria-label="Document text"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handlePaste}
                className="rounded-lg bg-(--wt-guardian-600) px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--wt-guardian-700)"
                data-testid="analyze-button"
              >
                Analyze
              </button>
              <button
                type="button"
                onClick={() => setText(SAMPLE_TEXT)}
                className="text-sm text-(--wt-ink-500) underline-offset-2 hover:text-(--wt-guardian-600) hover:underline"
                data-testid="try-example"
              >
                Try an example
              </button>
            </div>
            {error && (
              <p className="mt-3 text-sm text-(--wt-alert-600)" data-testid="error-message">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="p-4 sm:p-6">
            <label
              htmlFor="file-upload"
              className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-(--wt-ink-300) bg-(--wt-paper-50) p-6 text-center transition-colors hover:border-(--wt-guardian-600)"
              data-testid="dropzone"
            >
              <span className="text-sm font-medium text-(--wt-ink-700)">
                {fileName ?? "Drop a PDF, screenshot, or photo here"}
              </span>
              <span className="mt-1 text-xs text-(--wt-ink-500)">
                or click to browse — PNG, JPG, PDF up to 10MB
              </span>
            </label>
            <input
              ref={fileRef}
              id="file-upload"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.eml,.msg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              data-testid="file-input"
            />
            {error && (
              <p className="mt-3 text-sm text-(--wt-alert-600)" data-testid="error-message">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
