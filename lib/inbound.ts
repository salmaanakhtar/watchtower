// WT-11: inbound email infrastructure.
//
// Flow: `in.watchtower.salmaan.dev` MX → Resend inbound → `email.received`
// webhook (metadata only) → this module → Resend Received Emails API (full
// content) → anti-abuse gates → WT-3 extraction pipeline → Document + watch
// item (source "forward").
//
// Security:
//  - every webhook is Svix-signed (RESEND_WEBHOOK_SECRET); we verify with
//    Node crypto (no svix dep) and reject replay outside a 5-min window
//  - inbound text/attachments are encrypted at rest (WT-8)
//  - the forwarding address IS the auth boundary: a message is only ingested
//    for the user who owns the address it was sent to
//  - anti-abuse: per-address daily cap, size caps, spam quarantine, unknown
//    address quarantine, content dedupe, unsubscribe detection
//
// Reputation: the app never originates mail from the forwarding domain (only
// Resend's inbound MX accepts it), so DMARC/SPF/DKIM for inbound are about
// what providers see when they DELIVER to us. Resend handles that; we record
// bounce/complaint events (lib/reputation.ts) so the domain stays healthy.

import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { encryptField } from "@/lib/crypto";
import { extractDocumentText } from "@/lib/extraction";
import { ingestText, MAX_INGEST_CHARS } from "@/lib/ingest";
import { contentHash } from "@/lib/upload";

// ─── Constants ─────────────────────────────────────────────────────────────

export const INBOUND_DOMAIN = "in.watchtower.salmaan.dev";
export const INBOUND_ADDR_PREFIX = "u-";

export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024; // total body+attachments cap
export const MAX_PER_ADDRESS_PER_DAY = 50; // anti-abuse cap per forwarding address
export const MAX_CONTENT_CHARS = MAX_INGEST_CHARS;
export const SVIX_TOLERANCE_MS = 5 * 60 * 1000; // replay window

const ATTACH_MIME_ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "message/rfc822",
  "text/plain",
  "text/html",
]);

// Subject lines that mean the user wants out, not in.
const UNSUB_SUBJECT_RE = /^(unsubscribe|unsub|stop|cancel (my )?subscription|opt[- ]?out)\b/i;
const UNSUB_BODY_RE = /\b(unsubscribe|stop receiving|opt[- ]?out)\b/i;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InboundWebhookEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    received_for?: string[];
    message_id?: string;
    subject?: string;
    attachments?: { id: string; filename?: string; content_type?: string; size?: number }[];
  };
}

export interface ResendReceivedEmail {
  id: string;
  from?: string;
  to?: string[];
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, unknown> | null;
  message_id?: string | null;
  received_for?: string[];
  attachments?: { id: string; filename?: string; content_type?: string; size?: number }[];
  raw?: { download_url?: string | null };
}

// ─── Svix webhook verification (no external dep) ───────────────────────────

/**
 * Verify a Svix-signed webhook (Resend webhooks use Svix).
 * The raw body string must be passed (never re-stringified JSON).
 * Returns true when the signature is valid and within the replay window.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: { id?: string | null; timestamp?: string | null; signature?: string | null },
  secret: string | null | undefined,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;

  const t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(Date.now() / 1000 - t) > SVIX_TOLERANCE_MS / 1000) return false;

  const sig = String(signature);
  const provided = sig
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"))
    .map((s) => s.slice(3));
  if (provided.length === 0) return false;

  const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return provided.some((p) => {
    const a = Buffer.from(expected);
    const b = Buffer.from(p);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

// ─── Address resolution ────────────────────────────────────────────────────

/** Normalize an email address to a bare lowercase localpart@domain. */
export function normalizeAddress(addr: string | undefined | null): string | null {
  if (!addr) return null;
  // Strip a display-name prefix: "Name <a@b>" → "a@b"
  const angle = addr.trim().match(/<([^<>\s]+@[^<>\s]+)>/i);
  const bare = angle?.[1] ?? addr.trim();
  const m = bare.match(/^([^@<\s]+)@([^@>\s]+)$/i);
  if (!m) return null;
  return `${m[1].toLowerCase()}@${m[2].toLowerCase()}`;
}

/** Parse the local part from an email address. */
export function localPartOf(addr: string | undefined | null): string | null {
  const normalized = normalizeAddress(addr);
  if (!normalized) return null;
  return normalized.split("@")[0] ?? null;
}

/** Resolve the address a message was delivered to → active InboundAddress, or null. */
export async function resolveAddress(
  toAddresses: string[] | undefined | null,
  receivedFor: string[] | undefined | null,
): Promise<{ address: NonNullable<Awaited<ReturnType<typeof db.inboundAddress.findUnique>>>; userId: string } | null> {
  const candidates = [...(receivedFor ?? []), ...(toAddresses ?? [])]
    .map(localPartOf)
    .filter((p): p is string => typeof p === "string" && p.startsWith(INBOUND_ADDR_PREFIX));

  for (const localPart of candidates) {
    const address = await db.inboundAddress.findUnique({ where: { localPart } });
    if (address && address.active) {
      return { address, userId: address.userId };
    }
  }
  return null;
}

// ─── Anti-abuse gates ──────────────────────────────────────────────────────

export interface AbuseGateResult {
  ok: boolean;
  reason: "rate_limited" | "too_large" | "unknown_address" | "no_content" | null;
  dailyCount?: number;
}

/** Check per-address daily cap. */
export async function checkRateLimit(addressId: string, now: Date = new Date()): Promise<AbuseGateResult> {
  const since = new Date(now.getTime() - 86_400_000);
  const count = await db.inboundMessage.count({
    where: { addressId, createdAt: { gte: since } },
  });
  if (count >= MAX_PER_ADDRESS_PER_DAY) {
    return { ok: false, reason: "rate_limited", dailyCount: count };
  }
  return { ok: true, reason: null, dailyCount: count };
}

// ─── Resend received-email fetch ───────────────────────────────────────────

/**
 * Fetch the full received email (body + headers) from the Resend API.
 * The webhook only carries metadata; content must be pulled.
 * Returns null on any failure (the caller retries/quarantines).
 */
export async function fetchReceivedEmail(emailId: string): Promise<ResendReceivedEmail | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[wt11:inbound] fetch received email ${emailId} -> ${res.status}`);
      return null;
    }
    return (await res.json()) as ResendReceivedEmail;
  } catch (err) {
    console.error("[wt11:inbound] failed to fetch received email", err);
    return null;
  }
}

/**
 * Download an attachment from the Resend attachments API.
 * Returns { bytes, contentType, filename } or null.
 */
export async function fetchAttachment(attachmentId: string): Promise<{
  bytes: Buffer;
  contentType: string;
  filename: string;
} | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(attachmentId)}/attachment`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "application/octet-stream";
    const bytes = Buffer.from(await res.arrayBuffer());
    const contentDisposition = res.headers.get("content-disposition") ?? "";
    const nameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    return { bytes, contentType: ct.split(";")[0]?.trim() ?? ct, filename: nameMatch?.[1] ?? "attachment" };
  } catch (err) {
    console.error("[wt11:inbound] failed to fetch attachment", err);
    return null;
  }
}

// ─── Content assembly + extraction ─────────────────────────────────────────

function isUnsubscribe(email: { subject?: string | null; text?: string | null }): boolean {
  if (email.subject && UNSUB_SUBJECT_RE.test(email.subject.trim())) return true;
  const body = (email.text ?? "").trim();
  if (body.length > 0 && body.length < 400 && UNSUB_BODY_RE.test(body)) return true;
  return false;
}

/**
 * Build the text to ingest from a received email: prefer attachments (bills
 * are PDFs), else the plain-text body. Returns { text, method, extra } where
 * extra is non-ingestible context (subject/sender) preserved as provenance.
 */
export async function extractInboundText(
  email: ResendReceivedEmail,
): Promise<{ text: string | null; method: string; extractedBytes: number } | null> {
  const attachments = email.attachments ?? [];
  const totalSize = attachments.reduce((sum, a) => sum + (a.size ?? 0), 0);
  if (totalSize > MAX_MESSAGE_BYTES) return null; // too large

  // Try attachments first: the actionable document is the bill/PDF.
  for (const att of attachments) {
    if (!att.id || !att.filename) continue;
    const mime = (att.content_type ?? "").split(";")[0].trim().toLowerCase();
    if (!ATTACH_MIME_ALLOWED.has(mime)) continue;
    const fetched = await fetchAttachment(att.id);
    if (!fetched) continue;
    if (fetched.bytes.length > MAX_MESSAGE_BYTES) continue;

    const extracted = await extractDocumentText({
      bytes: fetched.bytes,
      decodedText: fetched.contentType.startsWith("text/") ? fetched.bytes.toString("utf8") : null,
      contentType: fetched.contentType,
      filename: fetched.filename,
    });
    if (extracted && extracted.text.trim()) {
      return { text: extracted.text, method: `attachment:${extracted.method}`, extractedBytes: fetched.bytes.length };
    }
  }

  // Fall back to the body text.
  const body = (email.text ?? email.html ?? "").trim();
  if (!body) return null;
  const htmlOnly = !email.text;
  return {
    text: body,
    method: htmlOnly ? "html" : "text",
    extractedBytes: Buffer.byteLength(body, "utf8"),
  };
}

// ─── Main inbound handler ──────────────────────────────────────────────────

export interface InboundProcessResult {
  messageId: string;
  status: "ingested" | "quarantined" | "ignored";
  reason?: string;
  documentId?: string;
}

/**
 * Process an inbound email end-to-end. Idempotent per Resend email_id:
 * a duplicate webhook returns the stored result without re-ingesting.
 */
export async function processInboundWebhook(event: InboundWebhookEvent): Promise<InboundProcessResult> {
  const emailId = event.data?.email_id;
  if (!emailId) return { messageId: "", status: "ignored", reason: "missing_email_id" };

  // Idempotency: already handled (webhooks are retried).
  const existing = await db.inboundMessage.findUnique({ where: { resendEmailId: emailId } });
  if (existing) {
    return {
      messageId: existing.id,
      status: existing.status === "ingested" ? "ingested" : "quarantined",
      reason: existing.quarantineReason ?? undefined,
      documentId: existing.documentId ?? undefined,
    };
  }

  // Resolve the owning address. Unknown/disabled addresses are quarantined,
  // never bounced (bouncing feeds back to the sender, hurting reputation).
  const resolved = await resolveAddress(event.data?.to, event.data?.received_for);
  if (!resolved) {
    const quarantined = await db.inboundMessage.create({
      data: {
        resendEmailId: emailId,
        messageId: event.data?.message_id ?? null,
        fromEmail: encryptField(event.data?.from) ?? null,
        subject: encryptField(event.data?.subject) ?? null,
        toAddress: event.data?.to?.[0] ?? null,
        receivedFor: event.data?.received_for?.[0] ?? null,
        status: "quarantined",
        quarantineReason: "unknown_address",
      },
    });
    return { messageId: quarantined.id, status: "quarantined", reason: "unknown_address" };
  }

  // Rate limit before any expensive work.
  const rate = await checkRateLimit(resolved.address.id);
  if (!rate.ok) {
    const quarantined = await db.inboundMessage.create({
      data: {
        addressId: resolved.address.id,
        userId: resolved.userId,
        resendEmailId: emailId,
        messageId: event.data?.message_id ?? null,
        fromEmail: encryptField(event.data?.from) ?? null,
        subject: encryptField(event.data?.subject) ?? null,
        toAddress: event.data?.to?.[0] ?? null,
        receivedFor: event.data?.received_for?.[0] ?? null,
        status: "quarantined",
        quarantineReason: "rate_limited",
      },
    });
    return { messageId: quarantined.id, status: "quarantined", reason: "rate_limited" };
  }

  // Persist the message as "received" so we can attach content later.
  const message = await db.inboundMessage.create({
    data: {
      addressId: resolved.address.id,
      userId: resolved.userId,
      resendEmailId: emailId,
      messageId: event.data?.message_id ?? null,
      fromEmail: encryptField(event.data?.from) ?? null,
      subject: encryptField(event.data?.subject) ?? null,
      toAddress: event.data?.to?.[0] ?? null,
      receivedFor: event.data?.received_for?.[0] ?? null,
      status: "received",
    },
  });

  // Fetch full content (body/headers/attachments).
  const email = await fetchReceivedEmail(emailId);
  if (!email) {
    await db.inboundMessage.update({ where: { id: message.id }, data: { status: "failed", failure: "fetch_failed" } });
    return { messageId: message.id, status: "quarantined", reason: "fetch_failed" };
  }

  // Unsubscribe handling: acknowledge and stop, never ingest.
  if (isUnsubscribe(email)) {
    await db.inboundMessage.update({
      where: { id: message.id },
      data: { status: "quarantined", quarantineReason: "unsubscribe", text: encryptField(email.text ?? null) ?? null, html: encryptField(email.html ?? null) ?? null },
    });
    return { messageId: message.id, status: "quarantined", reason: "unsubscribe" };
  }

  // Extract actionable text.
  const extracted = await extractInboundText(email);
  if (!extracted) {
    await db.inboundMessage.update({
      where: { id: message.id },
      data: { status: "quarantined", quarantineReason: "no_content" },
    });
    return { messageId: message.id, status: "quarantined", reason: "no_content" };
  }

  // Store the fetched content (encrypted at rest) on the message row.
  await db.inboundMessage.update({
    where: { id: message.id },
    data: {
      status: "fetched",
      text: encryptField(email.text ?? null) ?? null,
      html: encryptField(email.html ?? null) ?? null,
      headers: encryptField(JSON.stringify(email.headers ?? {})) ?? null,
      rawDownloadUrl: email.raw?.download_url ?? null,
      contentSize: extracted.extractedBytes,
      fromEmail: encryptField(email.from ?? event.data?.from) ?? null,
    },
  });

  // Dedupe by content hash: identical bills forwarded twice only ingest once.
  const hash = contentHash(extracted.text ?? "");
  const sameContent = await db.document.findFirst({
    where: { contentHash: hash },
    select: { id: true },
  });
  if (sameContent) {
    await db.inboundMessage.update({
      where: { id: message.id },
      data: { status: "ingested", ingestedAt: new Date(), documentId: sameContent.id, quarantineReason: null },
    });
    return { messageId: message.id, status: "ingested", reason: "dedupe", documentId: sameContent.id };
  }

  // Ingest through the shared pipeline.
  const content = extracted.text ?? "";
  const ingested = await ingestText(content, {
    source: "forward",
    filename: `forward-${message.id}.txt`,
    contentType: "text/plain",
    extractedText: content,
    extractionMethod: extracted.method,
    contentHashValue: hash,
  });

  if (!ingested) {
    await db.inboundMessage.update({
      where: { id: message.id },
      data: { status: "failed", failure: "ingest_failed" },
    });
    return { messageId: message.id, status: "quarantined", reason: "ingest_failed" };
  }

  await db.inboundMessage.update({
    where: { id: message.id },
    data: { status: "ingested", ingestedAt: new Date(), documentId: ingested.documentId, quarantineReason: null },
  });

  await db.event.create({
    data: {
      userId: resolved.userId,
      obligationId: ingested.obligationId ?? undefined,
      type: "inbound_ingested",
      detail: `email=${emailId} document=${ingested.documentId}`,
    },
  }).catch((err) => console.error("[wt11:inbound] event write failed", err));

  return {
    messageId: message.id,
    status: "ingested",
    documentId: ingested.documentId,
  };
}
