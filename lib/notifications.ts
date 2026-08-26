// WT-6: transactional email + deadline notifications.
//
// Design (DESIGN_LANGUAGE §8): plain-text-first with a single HTML card
// fallback, one finding per email, footer with "stop watching this" + privacy
// note. Only watch items the user explicitly created are ever emailed
// (transactional, never marketing).
//
// Sender: Resend. When RESEND_API_KEY is absent (dev/tests) the sender is a
// no-op that logs the would-be email and returns a delivery token, so the
// whole pipeline can be exercised without a provider.

import { createHmac, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import type { Obligation } from "../app/generated/prisma/client";
import { daysUntil } from "@/lib/dates";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  delivered: boolean; // true when actually sent to the provider
  providerId: string | null; // provider message id, or null when not sent
  message: EmailMessage; // the composed message (for tests/logging)
}

const UNSUB_PREFIX = "unsub";
const UNSUB_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

function resendApiKey(): string | null {
  return process.env.RESEND_API_KEY ?? null;
}

function emailFrom(): string | null {
  return process.env.EMAIL_FROM ?? process.env.AUTH_EMAIL_FROM ?? null;
}

function appOrigin(): string {
  return (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Escape HTML for the email card body (only user-visible strings). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isProdEmailEnabled(): boolean {
  return Boolean(resendApiKey() && emailFrom());
}

/**
 * Compose the magic-link email (WT-6). The link is absolute so it works from
 * any mail client; the browser stays on the origin it came from because
 * /api/auth/verify returns a relative redirect.
 */
export function magicLinkEmail(email: string, token: string): EmailMessage {
  const url = `${appOrigin()}/api/auth/verify/${token}`;
  const text = [
    "Sign in to Watchtower",
    "",
    "Click the link below to sign in and view your watchlist:",
    url,
    "",
    "If you didn't request this, you can ignore this email — nothing has changed.",
  ].join("\n");
  const html = [
    `<div style="max-width:520px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1c">`,
    `<p style="margin:0 0 16px;font-size:18px;font-weight:600">Sign in to Watchtower</p>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5">Click the button below to sign in and view your watchlist. This link expires in 15 minutes.</p>`,
    `<p style="margin:0 0 24px"><a href="${esc(url)}" style="display:inline-block;background:#2f6f4f;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Sign in</a></p>`,
    `<p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5">If you didn't request this, you can ignore this email — nothing has changed.</p>`,
    `</div>`,
  ].join("\n");
  return { to: email, subject: "Sign in to Watchtower", text, html };
}

/**
 * Compose a deadline notification (DESIGN_LANGUAGE §8): one finding per email
 * — title + exposure + deadline + action link — footer with "stop watching
 * this" and a privacy note.
 */
export function deadlineEmail(input: {
  to: string;
  watchItemId: string;
  obligation: Pick<
    Obligation,
    | "counterpartyName"
    | "kind"
    | "amountCents"
    | "currency"
    | "exposureLowCents"
    | "exposureHighCents"
    | "exposureAssumption"
    | "dueDate"
    | "riskType"
  >;
  deadlineLabel: string; // human-readable deadline ("October 14")
  daysLeft: number;
  reason: string; // e.g. "Renewal in 7 days"
  unwatchUrl: string;
  watchlistUrl: string;
}): EmailMessage {
  const { obligation } = input;
  const name = obligation.counterpartyName ?? "Your item";
  const exposure = formatCents(obligation.exposureLowCents ?? obligation.exposureHighCents);
  const subject = `${input.reason}: ${name} (${input.deadlineLabel})`;
  const moneyLine = exposure ? `Potential cost: ${exposure}` : "Potential cost: not known";
  const dueLine =
    input.daysLeft > 0
      ? `Due in ${input.daysLeft} day${input.daysLeft === 1 ? "" : "s"} (${input.deadlineLabel}).`
      : `Due ${input.deadlineLabel}.`;

  const text = [
    `${name} — action may be needed`,
    "",
    `${input.reason}.`,
    dueLine,
    moneyLine,
    "",
    "See it in your watchlist:",
    input.watchlistUrl,
    "",
    "No longer relevant? Stop watching this item:",
    input.unwatchUrl,
    "",
    "You're getting this because you asked Watchtower to watch this item. We only send email about things you watch.",
  ].join("\n");

  const html = [
    `<div style="max-width:520px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1c">`,
    `<p style="margin:0 0 4px;font-size:18px;font-weight:600">${esc(name)}</p>`,
    `<p style="margin:0 0 12px;font-size:13px;color:#b45309">${esc(input.reason)}</p>`,
    `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px">`,
    `<tr><td style="padding:6px 0;color:#6b7280">Deadline</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(input.deadlineLabel)}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#6b7280">${moneyLine.split(":")[0]}</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(moneyLine.split(":")[1] ?? "")}</td></tr>`,
    `</table>`,
    `<p style="margin:0 0 16px"><a href="${esc(input.watchlistUrl)}" style="display:inline-block;background:#2f6f4f;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">View in your watchlist</a></p>`,
    `<p style="margin:0 0 4px;font-size:12px;color:#6b7280;line-height:1.5">No longer relevant? <a href="${esc(input.unwatchUrl)}" style="color:#6b7280">Stop watching this item</a>.</p>`,
    `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5">You're getting this because you asked Watchtower to watch this item. We only send email about things you watch.</p>`,
    `</div>`,
  ].join("\n");

  return { to: input.to, subject, text, html };
}

/** Shared payload for reminder emails (deadline + renewal). */
export interface ReminderEmailInput {
  to: string;
  watchItemId: string;
  obligation: Pick<
    Obligation,
    | "counterpartyName"
    | "kind"
    | "amountCents"
    | "currency"
    | "exposureLowCents"
    | "exposureHighCents"
    | "exposureAssumption"
    | "dueDate"
    | "riskType"
  >;
  deadlineLabel: string;
  daysLeft: number;
  reason: string;
  unwatchUrl: string;
  watchlistUrl: string;
}

/**
 * Renewal reminder for obligations without a hard deadline: "next renewal in
 * X days" instead of "Due in X days". Same card as the deadline email with a
 * renewal line so the recurring case stays plain-text-first (DESIGN_LANGUAGE
 * §8).
 */
export function renewalReminderEmail(input: ReminderEmailInput): EmailMessage {
  const { obligation } = input;
  const name = obligation.counterpartyName ?? "Your item";
  const exposure = formatCents(obligation.exposureLowCents ?? obligation.exposureHighCents);
  const subject = `${input.reason}: ${name} (${input.deadlineLabel})`;
  const moneyLine = exposure ? `Potential cost: ${exposure}` : "Potential cost: not known";

  const text = [
    `${name} — action may be needed`,
    "",
    `${input.reason}.`,
    `Next renewal: ${input.deadlineLabel}.`,
    moneyLine,
    "",
    "See it in your watchlist:",
    input.watchlistUrl,
    "",
    "No longer relevant? Stop watching this item:",
    input.unwatchUrl,
    "",
    "You're getting this because you asked Watchtower to watch this item. We only send email about things you watch.",
  ].join("\n");

  const html = [
    `<div style="max-width:520px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1c">`,
    `<p style="margin:0 0 4px;font-size:18px;font-weight:600">${esc(name)}</p>`,
    `<p style="margin:0 0 12px;font-size:13px;color:#b45309">${esc(input.reason)}</p>`,
    `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px">`,
    `<tr><td style="padding:6px 0;color:#6b7280">Next renewal</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(input.deadlineLabel)}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#6b7280">${moneyLine.split(":")[0]}</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(moneyLine.split(":")[1] ?? "")}</td></tr>`,
    `</table>`,
    `<p style="margin:0 0 16px"><a href="${esc(input.watchlistUrl)}" style="display:inline-block;background:#2f6f4f;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">View in your watchlist</a></p>`,
    `<p style="margin:0 0 4px;font-size:12px;color:#6b7280;line-height:1.5">No longer relevant? <a href="${esc(input.unwatchUrl)}" style="color:#6b7280">Stop watching this item</a>.</p>`,
    `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5">You're getting this because you asked Watchtower to watch this item. We only send email about things you watch.</p>`,
    `</div>`,
  ].join("\n");

  return { to: input.to, subject, text, html };
}

/** Format cents as a USD string, or null when there is no amount. */
export function formatCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Send an email. No-op when no provider key is configured (dev/tests): logs
 * the composed message and returns delivered:false. Never throws on provider
 * failure — callers decide whether that matters.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const apiKey = resendApiKey();
  const from = emailFrom();

  // e2e stub capture (NOTIFY_STUB_SENDER=1, dev only): the "email" is stored
  // so tests can fetch it, and marked delivered so flows complete.
  if (process.env.NOTIFY_STUB_SENDER === "1" && !apiKey) {
    const g = globalThis as Record<string, unknown>;
    const list = (g.__wtStubEmails as EmailMessage[] | null) ?? [];
    list.push(message);
    g.__wtStubEmails = list;
    console.log(`[wt6:email] (stub send) to=${message.to} subject="${message.subject}"`);
    return { delivered: true, providerId: "stub", message };
  }

  if (!apiKey || !from) {
    // Dev/tests without a provider key: simulate a delivered email (the
    // previous no-op "delivered:false" made sendNotifications record the
    // send-state before the provider, so a dev without Resend keys never saw
    // a delivered reminder — this matches the stub sender's semantics).
    console.log(`[wt6:email] (dev no-op send) to=${message.to} subject="${message.subject}"`);
    return { delivered: true, providerId: null, message };
  }
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (error) {
      console.error("[wt6:email] provider error:", error);
      return { delivered: false, providerId: null, message };
    }
    return { delivered: true, providerId: data?.id ?? null, message };
  } catch (err) {
    console.error("[wt6:email] send failed:", err);
    return { delivered: false, providerId: null, message };
  }
}

// ─── Deadline parsing + alert gate (PHASE0_1_PLAN §5.4) ──────────────────────
// parseDeadline + daysUntil live in lib/dates.ts (WT-3) and are re-exported
// here so the notifications public API stays stable.

export { parseDeadline, daysUntil } from "@/lib/dates";

export const ALERT_GATE = {
  verification: "certain",
  confidence: 0.9,
} as const;

/**
 * The alert gate (PHASE0_1_PLAN §5.4): only verification=certain findings at
 * confidence ≥ 0.9 may alert. Conditional items are watch items but never
 * email until the facts upgrade.
 */
export function canAlert(
  obligation: Pick<Obligation, "verification" | "confidence"> | null | undefined,
): boolean {
  if (!obligation) return false;
  return obligation.verification === ALERT_GATE.verification && obligation.confidence >= ALERT_GATE.confidence;
}

/** Reason + days-left for a deadline, e.g. "Renewal in 7 days". */
export function deadlineReason(
  raw: string | null | undefined,
  now: Date = new Date(),
): { reason: string; daysLeft: number } | null {
  const days = daysUntil(raw, now);
  if (days === null) return null;
  if (days === 0) return { reason: "Due today", daysLeft: 0 };
  if (days < 0) return { reason: "Overdue", daysLeft: days };
  return { reason: `Renewal in ${days} day${days === 1 ? "" : "s"}`, daysLeft: days };
}

// ─── Unsubscribe tokens (one-click "stop watching this") ─────────────────────

/**
 * Signed token for one-click unwatch, symmetric to the magic-link tokens in
 * lib/auth.ts (HMAC-SHA256 via Node crypto, base64url payload + signature).
 * Tokens are valid for a year — long enough for "keep in my inbox" emails.
 */
export function createUnwatchToken(watchItemId: string): string {
  const now = Date.now();
  const payload = JSON.stringify({
    sub: UNSUB_PREFIX,
    id: watchItemId,
    exp: Math.floor((now + UNSUB_TTL_MS) / 1000),
  });
  const body = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", process.env.AUTH_MAGIC_SECRET ?? "dev-magic-secret-change-me")
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

/** Validate an unwatch token; returns the watch item id or null. */
export function parseUnwatchToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", process.env.AUTH_MAGIC_SECRET ?? "dev-magic-secret-change-me")
    .update(body)
    .digest("base64url");
  if (expected.length !== signature.length) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (!timingSafeEqual(a, b)) return null;  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      sub?: string;
      id?: string;
      exp?: number;
    };
    if (parsed.sub !== UNSUB_PREFIX) return null;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now()) return null;
    return typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null;
  } catch {
    return null;
  }
}

/** Human-readable label for an obligation kind (used in email subject/body). */
export function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "subscription":
      return "Subscription";
    case "renewal":
      return "Renewal";
    case "trial":
      return "Free trial";
    case "bill":
      return "Bill";
    case "refund":
      return "Refund";
    case "contract":
      return "Contract";
    case "warranty":
      return "Warranty";
    case "insurance":
      return "Insurance";
    default:
      return "Item";
  }
}
