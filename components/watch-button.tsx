"use client";

import { useState } from "react";
import { Button } from "./ui/button";

/**
 * The single conversion CTA (DESIGN_LANGUAGE §6.6). "Watch this for me" creates
 * a watch item for the given obligation. Anonymous users are offered an email
 * capture; after the magic link they land back here (via wt_pending_obligation).
 */
export function WatchButton({ obligationId }: { obligationId: string }) {
  const [mode, setMode] = useState<"idle" | "email" | "sending" | "sent" | "done">("idle");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);

  async function startWatch() {
    setError(null);
    setMode("sending");
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obligationId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't start watching");
      if (json.needsAccount) {
        setMode("email");
        return;
      }
      setMode("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setMode("idle");
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSendingLink(true);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't send the link");
      // Dev-mode: the magic link is returned so the flow completes without an
      // email provider. Production would show "Check your email."
      if (json.token) {
        setMagicLink(`/api/auth/verify/${json.token}`);
      }
      setMode("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setMode("email");
    } finally {
      setSendingLink(false);
    }
  }

  if (mode === "done") {
    return (
      <div
        className="rounded-lg bg-(--wt-save-100) px-4 py-3 text-sm font-semibold text-(--wt-save-600)"
        data-testid="watching-state"
      >
        Watching — we&apos;ll remind you before this deadline.{" "}
        <a href="/watchlist" className="underline underline-offset-2">
          View watchlist
        </a>
      </div>
    );
  }

  if (mode === "sent") {
    return (
      <div
        className="rounded-lg border border-(--wt-save-100) bg-(--wt-save-100)/40 px-4 py-3 text-sm text-(--wt-ink-700)"
        data-testid="watch-email-sent"
      >
        {magicLink ? (
          <p>
            Dev mode:{" "}
            <a href={magicLink} className="font-semibold text-(--wt-guardian-600) underline">
              complete sign-in
            </a>{" "}
            to start watching.
          </p>
        ) : (
          <p>
            Check <span className="font-semibold">{email}</span> for your sign-in link. Once
            you&apos;re in, we&apos;ll start watching this.
          </p>
        )}
      </div>
    );
  }

  if (mode === "email") {
    return (
      <form
        onSubmit={sendMagicLink}
        className="rounded-lg border border-(--wt-ink-300) p-4"
        data-testid="watch-email-form"
      >
        <p className="text-sm font-semibold text-(--wt-ink-900)">
          Create a free account to watch this
        </p>
        <p className="mt-1 text-xs text-(--wt-ink-500)">
          We&apos;ll email you a sign-in link. No passwords, ever.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="flex-1 rounded-lg border border-(--wt-ink-300) bg-(--wt-paper-50) px-3 py-2 text-sm outline-none focus:border-(--wt-guardian-600) focus:ring-2 focus:ring-(--wt-guardian-600)/20"
            data-testid="watch-email-input"
            aria-label="Email address"
          />
          <Button
            type="submit"
            disabled={sendingLink}
            data-testid="watch-email-submit"
          >
            {sendingLink ? "Sending…" : "Email me a link"}
          </Button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-(--wt-alert-600)" data-testid="watch-error">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        onClick={startWatch}
        disabled={mode === "sending"}
        className="w-full"
        data-testid="watch-button"
      >
        Watch this for me
      </Button>
      {error && (
        <p className="text-sm text-(--wt-alert-600)" data-testid="watch-error">
          {error}
        </p>
      )}
    </div>
  );
}
