// WT-8: durable rate limiting.
//
// Per-email magic-link limiter (DB-backed, survives restarts) + a lightweight
// in-memory per-IP limiter for anonymous endpoints (analyses, waitlist).
// The previous 1/min magic-link cooldown compared against the *global* last
// request — this scopes it per email, which is the actual abuse vector.

import { db } from "@/lib/db";
import { hashForLookup } from "@/lib/crypto";

export const MAGIC_LINK_COOLDOWN_MS = 60_000; // 1 link per email per minute
export const MAGIC_LINK_MAX_PER_HOUR = 5;

/** True when the email is still on cooldown (recent magic link already sent). */
export async function magicLinkOnCooldown(email: string): Promise<boolean> {
  const emailHash = hashForLookup(email.toLowerCase());
  const recent = await db.event.findFirst({
    where: { type: "magic_requested", detail: emailHash },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!recent) return false;
  return Date.now() - recent.createdAt.getTime() < MAGIC_LINK_COOLDOWN_MS;
}

/** True when the email has hit the hourly magic-link cap. */
export async function magicLinkRateExceeded(email: string): Promise<boolean> {
  const emailHash = hashForLookup(email.toLowerCase());
  const since = new Date(Date.now() - 3_600_000);
  const count = await db.event.count({
    where: { type: "magic_requested", detail: emailHash, createdAt: { gte: since } },
  });
  return count >= MAGIC_LINK_MAX_PER_HOUR;
}

/** Record a sent magic link (keyed by email hash, not plaintext). */
export async function recordMagicLink(email: string): Promise<void> {
  try {
    await db.event.create({
      data: { type: "magic_requested", detail: hashForLookup(email.toLowerCase()) },
    });
  } catch (err) {
    console.error("[wt8:ratelimit] failed to record magic link", err);
  }
}

// ─── Per-IP limiter (in-memory; resets on restart, good enough for Phase 1) ──

const IP_WINDOW_MS = 10 * 60_000;
const IP_MAX_ANALYSES = 20;

const ipBuckets = new Map<string, { count: number; windowStart: number }>();

function pruneBuckets(now: number): void {
  for (const [key, b] of ipBuckets) {
    if (now - b.windowStart > IP_WINDOW_MS) ipBuckets.delete(key);
  }
}

/** True when the IP has exceeded the anonymous analysis quota. */
export function ipRateExceeded(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const now = Date.now();
  pruneBuckets(now);
  const key = `analyses:${ip}`;
  const bucket = ipBuckets.get(key);
  if (!bucket || now - bucket.windowStart > IP_WINDOW_MS) {
    ipBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > IP_MAX_ANALYSES;
}

/** Test hook. */
export function _resetIpLimiterForTests(): void {
  ipBuckets.clear();
}
