"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { EmptyState } from "./ui/empty-state";

export interface ForwardingAddress {
  id: string;
  localPart: string;
  domain: string;
  active: boolean;
  createdAt: string;
}

const INBOUND_DOMAIN = "in.watchtower.salmaan.dev";

function fullAddress(a: ForwardingAddress): string {
  return `${a.localPart}@${a.domain || INBOUND_DOMAIN}`;
}

function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

export function ForwardingView({
  address: initial,
  received,
}: {
  address: ForwardingAddress | null;
  received: number;
}) {
  const [address, setAddress] = useState<ForwardingAddress | null>(initial);
  const [incoming, setIncoming] = useState<number>(received);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "provision" | "rotate" | "disable") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/forwarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        return;
      }
      setAddress(json.address);
      if (json.address) setIncoming(0);
      if (action === "disable") setIncoming(0);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--wt-ink-900)">Email forwarding</h1>
          <p className="mt-1 text-sm text-(--wt-ink-500)">
            Forward bills and renewal notices here — Watchtower will watch them for you.
          </p>
        </div>
        <Link href="/watchlist" className={buttonClasses("secondary")}>
          Back to watchlist
        </Link>
      </header>

      {error && (
        <div
          className="mt-6 rounded-lg border border-(--wt-alert-600)/40 bg-(--wt-alert-100) px-4 py-3 text-sm text-(--wt-alert-600)"
          data-testid="forwarding-error"
        >
          {error}
        </div>
      )}

      {address ? (
        <Card className="mt-8 p-6" testId="forwarding-card">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-(--wt-ink-900)">Your forwarding address</h2>
            <Badge tone={address.active ? "save" : "neutral"} variant="solid">
              {address.active ? "Active" : "Disabled"}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code
              className="rounded-lg border border-(--wt-ink-300) bg-(--wt-paper-50) px-4 py-2.5 text-sm font-semibold text-(--wt-ink-900) select-all"
              data-testid="forwarding-address"
            >
              {fullAddress(address)}
            </code>
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                copyToClipboard(fullAddress(address));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="px-3 py-2 text-xs"
              data-testid="copy-address"
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>

          <p className="mt-4 text-sm text-(--wt-ink-500)">
            Set up a filter in your email (Gmail, Outlook, etc.) that automatically forwards
            bills, receipts, and renewal notices to this address. Your personal address stays
            private — senders only ever see this one.
          </p>

          {incoming > 0 && (
            <p className="mt-4 rounded-lg bg-(--wt-paper-50) px-3 py-2 text-sm text-(--wt-ink-700)" data-testid="forwarding-received">
              {incoming} forwarded message{incoming === 1 ? "" : "s"} processed so far.
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => run("rotate")}
              className="px-3 py-2 text-xs"
              data-testid="rotate-address"
            >
              {busy === "rotate" ? "Rotating…" : "Rotate address"}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy !== null}
              onClick={() => run("disable")}
              className="px-3 py-2 text-xs"
              data-testid="disable-address"
            >
              {busy === "disable" ? "Disabling…" : "Disable forwarding"}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="mt-10">
          <EmptyState
            title="No forwarding address yet"
            action={
              <Button
                type="button"
                disabled={busy === "provision"}
                onClick={() => run("provision")}
                data-testid="provision-address"
              >
                {busy === "provision" ? "Creating…" : "Create forwarding address"}
              </Button>
            }
            testId="forwarding-empty"
          />
        </div>
      )}
    </main>
  );
}
