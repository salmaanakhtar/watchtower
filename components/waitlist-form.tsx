"use client";

import { useState } from "react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "result" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="w-full max-w-2xl mx-auto rounded-xl bg-(--wt-save-100) p-6 text-center" data-testid="waitlist-done">
        <p className="font-semibold text-(--wt-ink-900)">You&apos;re on the list.</p>
        <p className="mt-1 text-sm text-(--wt-ink-700)">
          We&apos;ll email you when Watchtower can watch your documents for real.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="w-full max-w-2xl mx-auto rounded-xl bg-(--wt-paper-0) border border-(--wt-ink-300) p-6"
      data-testid="waitlist-form"
    >
      <h3 className="text-lg font-semibold text-(--wt-ink-900)">
        Want Watchtower to watch your bills for you?
      </h3>
      <p className="mt-1 text-sm text-(--wt-ink-500)">
        Join the early-access list. No spam, one email when we launch.
      </p>      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 rounded-lg border border-(--wt-ink-300) bg-(--wt-paper-50) px-3 py-2.5 text-sm outline-none focus:border-(--wt-guardian-600) focus:ring-2 focus:ring-(--wt-guardian-600)/20"
          data-testid="waitlist-email"
          aria-label="Email address"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="rounded-lg bg-(--wt-guardian-600) px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--wt-guardian-700) disabled:opacity-50"
          data-testid="waitlist-submit"
        >
          {state === "loading" ? "Joining…" : "Join the list"}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-(--wt-alert-600)" data-testid="waitlist-error">
          {error}
        </p>
      )}
    </form>
  );
}
