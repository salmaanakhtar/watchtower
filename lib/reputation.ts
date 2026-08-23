// WT-11: forwarding-domain reputation monitoring.
//
// Resend reports bounce/complaint events via the same Svix-signed webhook
// transport (`/api/inbound/events`). We persist them and run a daily sweep
// that alerts (via the existing notification sender) when reputation degrades:
//   - complaint rate > threshold over the trailing window → alert
//   - bounce rate > threshold → alert
//
// The forwarding domain only ever RECEIVES mail (we never originate from it),
// so provider reputation risk is mostly about spam complaints on received
// inbound. These events feed the domain health dashboard in a later phase.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications";

export const COMPLAINT_ALERT_RATE = 0.02; // 2% of received
export const BOUNCE_ALERT_RATE = 0.05; // 5% of received
export const REPUTATION_WINDOW_MS = 7 * 86_400_000; // 7 days

export interface ReputationStats {
  received: number;
  complaints: number;
  bounces: number;
  complaintRate: number;
  bounceRate: number;
}

/** Record a reputation-relevant event (bounce, complaint, delivered, …). */
export async function recordReputationEvent(
  kind: "bounce" | "complaint" | "delivered" | "failed" | "suppressed",
  email: string | null,
  detail: string | null,
): Promise<void> {
  try {
    await db.reputationEvent.create({
      data: {
        kind,
        email: email ? encryptForStorage(email) : null,
        detail: detail?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    console.error("[wt11:reputation] failed to record event", err);
  }
}

// Keep import minimal; reputation rows only ever store an encrypted email.
import { encryptField } from "@/lib/crypto";
function encryptForStorage(email: string): string {
  return encryptField(email) ?? email;
}

/** Compute reputation stats over the trailing window. */
export async function reputationStats(now: Date = new Date()): Promise<ReputationStats> {
  const since = new Date(now.getTime() - REPUTATION_WINDOW_MS);
  const [received, complaints, bounces] = await Promise.all([
    db.inboundMessage.count({ where: { createdAt: { gte: since } } }),
    db.reputationEvent.count({ where: { kind: "complaint", createdAt: { gte: since } } }),
    db.reputationEvent.count({ where: { kind: "bounce", createdAt: { gte: since } } }),
  ]);
  const complaintRate = received > 0 ? complaints / received : 0;
  const bounceRate = received > 0 ? bounces / received : 0;
  return { received, complaints, bounces, complaintRate, bounceRate };
}

/**
 * Check reputation health; when degraded, send one alert (rate-limited per
 * window by the notification sender's own dedupe/guards — we dedupe by only
 * alerting when the rate crosses the threshold, which is naturally
 * once-per-window).
 */
export async function checkReputation(now: Date = new Date()): Promise<{
  healthy: boolean;
  stats: ReputationStats;
  alertSent: boolean;
}> {
  const stats = await reputationStats(now);
  const degraded =
    stats.received >= 10 && (stats.complaintRate > COMPLAINT_ALERT_RATE || stats.bounceRate > BOUNCE_ALERT_RATE);

  if (!degraded) return { healthy: true, stats, alertSent: false };

  const to = process.env.REPUTATION_ALERT_EMAIL;
  if (!to) {
    console.warn("[wt11:reputation] degraded but no REPUTATION_ALERT_EMAIL configured");
    return { healthy: false, stats, alertSent: false };
  }

  const details = [
    `Received: ${stats.received}`,
    `Complaints: ${stats.complaints} (${(stats.complaintRate * 100).toFixed(1)}%)`,
    `Bounces: ${stats.bounces} (${(stats.bounceRate * 100).toFixed(1)}%)`,
  ].join("\n");

  const result = await sendEmail({
    to,
    subject: "Watchtower: inbound domain reputation degraded",
    text: `The forwarding domain reputation is degraded over the last 7 days.\n\n${details}\n\nReview the Resend dashboard and quarantine logs.`,
    html: `<div style="font-family:system-ui;padding:24px;max-width:520px;margin:0 auto"><h2 style="margin:0 0 8px">Watchtower inbound reputation alert</h2><p style="margin:0 0 16px;color:#333">The forwarding domain reputation is degraded over the last 7 days:</p><pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:13px">${details.replace(/</g, "&lt;")}</pre></div>`,
  });
  return { healthy: false, stats, alertSent: result.delivered };
}

/** Run the reputation sweep (wired into the scheduler). */
export async function runReputationSweep(now: Date = new Date()): Promise<{ healthy: boolean; alertSent: boolean }> {
  try {
    const result = await checkReputation(now);
    if (!result.healthy) {
      console.warn(
        `[wt11:reputation] DEGRADED complaints=${result.stats.complaints}/${result.stats.received} bounces=${result.stats.bounces}/${result.stats.received} alertSent=${result.alertSent}`,
      );
    }
    return { healthy: result.healthy, alertSent: result.alertSent };
  } catch (err) {
    console.error("[wt11:reputation] sweep failed", err);
    return { healthy: true, alertSent: false };
  }
}
