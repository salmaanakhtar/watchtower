// WT-14: deadline reminder sweep — the lifecycle half of notifications.
//
// Selects watch items that need a reminder and sends one email per item per
// deadline. WT-6 shipped the transport + an initial 7/3/1 sweep; this module
// reworks the schedule around the watchlist lifecycle (PHASE0_1_PLAN §5.3):
//
//   open → upcoming → due → resolved/dismissed
//
// Selection rules:
//   - item not resolved/dismissed
//   - obligation passes the alert gate (verification=certain, confidence ≥ 0.9)
//   - a deadline can be determined. Effective deadline order (WT-14):
//       1. WatchItem.deadline (explicit user set)
//       2. nearest future NoticeDeadline on the obligation (multi-deadline)
//       3. Obligation.dueDate (hard deadline, legacy label fallback)
//       4. Obligation.renewalDate — "next renewal" reminder when there is no
//          hard deadline (recurring obligations only)
//   - the deadline is within the notify window (default T-7 and T-1 days,
//     env-configurable NOTIFY_WINDOW_DAYS)
//   - never already notified for this deadline at the same or looser cadence
//     (lastNotifiedCadence guard — explicit, restart-safe)
//
// Lifecycle: sending the T-7 reminder moves the item open → upcoming; sending
// the T-1 reminder (or finding it due with a deadline inside the window)
// moves it upcoming → due. Resolution/dismissal stops reminders forever.
//
// Idempotence: dedupe is enforced transactionally — the sweep marks
// notifiedAt + lastNotifiedCadence and writes an Event row per send inside a
// transaction, and re-running it skips items already handled at that cadence.

import { db } from "@/lib/db";
import { decryptField } from "@/lib/crypto";
import {
  sendEmail,
  createUnwatchToken,
  renewalReminderEmail,
  parseDeadline,
} from "@/lib/notifications";

/** Notify at 7 and 1 day(s) before the deadline (WT-14; configurable). */
export function notifyWindowDays(env: NodeJS.ProcessEnv = process.env): number[] {
  const raw = env.NOTIFY_WINDOW_DAYS;
  if (raw && raw.trim() !== "") {
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => b - a); // T-7, T-3, … T-1 — strictest cadence first
    if (parsed.length > 0) return parsed;
  }
  return [7, 1];
}

/** Whether a deadline is "in the notify window" at the given days-out. */
export function inWindow(daysLeft: number, window = notifyWindowDays()): boolean {
  if (daysLeft < 0) return false;
  return window.some((d) => daysLeft <= d);
}

/** The cadence (days-before) a reminder about this deadline should use. */
export function cadenceFor(daysLeft: number, window = notifyWindowDays()): number | null {
  if (daysLeft < 0) return null;
  const qualifying = window.filter((d) => daysLeft <= d);
  if (qualifying.length === 0) return null;
  return Math.min(...qualifying); // strictest cadence still ahead (T-1 wins over T-7)
}

/** Day buckets for the reason line ("in 7 days" / "in 1 day"). */
export function dayBucket(daysLeft: number): number {
  return daysLeft <= 1 ? 1 : 7;
}

export interface SweepStats {
  selected: number;
  sent: number;
  skipped: number;
  failed: number;
  items: { id: string; reason: string }[];
}

interface Candidate {
  watchItemId: string;
  userId: string;
  obligationId: string;
  counterpartyName: string | null;
  kind: string | null;
  amountCents: number | null;
  currency: string | null;
  exposureLowCents: number | null;
  exposureHighCents: number | null;
  exposureAssumption: string | null;
  riskType: string | null;
  verification: string | null;
  confidence: number | null;
  dueDate: Date | null;
  renewalDate: Date | null;
  watchDeadline: Date | null;
  lastNotifiedCadence: number | null;
  userEmail: string | null;
  submissionDeadlineLabel: string | null;
  noticeDeadlines: { id: string; kind: string; dueAt: Date; description: string | null }[];
}

/** Effective deadline for an item: WatchItem.deadline > nearest future NoticeDeadline > Obligation.dueDate > legacy label. */
export function effectiveDeadline(c: Candidate, now: Date = new Date()): Date | null {
  if (c.watchDeadline) return c.watchDeadline;
  const future = c.noticeDeadlines
    .filter((n) => n.dueAt.getTime() >= now.getTime())
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  if (future.length > 0) return future[0]!.dueAt;
  return c.dueDate ?? (c.submissionDeadlineLabel ? parseDeadline(c.submissionDeadlineLabel, now) : null);
}

/** Next renewal for obligations with no hard deadline (recurring kinds). */
export function renewalDeadline(c: Candidate, now: Date = new Date()): Date | null {
  if (effectiveDeadline(c, now)) return null; // hard deadline wins
  if (!c.renewalDate) return null;
  if (!isRecurring(c.kind)) return null;
  return c.renewalDate;
}

export function isRecurring(kind: string | null | undefined): boolean {
  return ["subscription", "trial", "insurance", "warranty"].includes(kind ?? "");
}

/** Select watch items that need a notification today. */
export async function selectCandidates(now: Date = new Date()): Promise<Candidate[]> {
  const window = notifyWindowDays();
  const rows = await db.watchItem.findMany({
    where: { status: { in: ["open", "upcoming", "due"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      status: true,
      deadline: true,
      notifiedAt: true,
      lastNotifiedCadence: true,
      user: { select: { email: true } },
      obligation: {
        select: {
          id: true,
          kind: true,
          counterpartyName: true,
          amountCents: true,
          currency: true,
          exposureLowCents: true,
          exposureHighCents: true,
          exposureAssumption: true,
          riskType: true,
          verification: true,
          confidence: true,
          dueDate: true,
          renewalDate: true,
          user: { select: { email: true } },
          document: { select: { submissionId: true } },
          noticeDeadlines: {
            select: { id: true, kind: true, dueAt: true, description: true },
            orderBy: { dueAt: "asc" },
          },
        },
      },
    },
  });

  const submissionIds = rows
    .map((r) => r.obligation.document?.submissionId)
    .filter((s): s is string => Boolean(s));
  const submissions = submissionIds.length
    ? await db.submission.findMany({
        where: { id: { in: submissionIds } },
        select: { id: true, result: true },
      })
    : [];
  const labelBySubmission = new Map<string, string | null>();
  for (const s of submissions) {
    let label: string | null = null;
    if (s.result) {
      try {
        label = (JSON.parse(s.result) as { deadline?: string | null }).deadline ?? null;
      } catch {
        label = null;
      }
    }
    labelBySubmission.set(s.id, label);
  }

  const candidates: Candidate[] = [];
  for (const r of rows) {
    const o = r.obligation;
    const label = r.obligation.document?.submissionId
      ? labelBySubmission.get(r.obligation.document.submissionId) ?? null
      : null;

    // Alert gate: certain + confidence ≥ 0.9 (PHASE0_1_PLAN §5.4). The
    // recipient email comes from the watch item's user (the authenticated
    // entity) — obligations created by the anonymous analyzer have no userId.
    if (o.verification !== "certain" || (o.confidence ?? 0) < 0.9) continue;
    const email = decryptField(r.user?.email) ?? decryptField(o.user?.email);
    if (!email) continue;

    candidates.push({
      watchItemId: r.id,
      userId: r.userId ?? "",
      obligationId: o.id,
      counterpartyName: o.counterpartyName,
      kind: o.kind,
      amountCents: o.amountCents,
      currency: o.currency ?? "USD",
      exposureLowCents: o.exposureLowCents,
      exposureHighCents: o.exposureHighCents,
      exposureAssumption: o.exposureAssumption,
      riskType: o.riskType,
      verification: o.verification,
      confidence: o.confidence,
      dueDate: o.dueDate,
      renewalDate: o.renewalDate,
      watchDeadline: r.deadline,
      lastNotifiedCadence: r.lastNotifiedCadence,
      userEmail: email,
      submissionDeadlineLabel: label,
      noticeDeadlines: o.noticeDeadlines,
    });
  }

  const selected: Candidate[] = [];
  for (const c of candidates) {
    const deadline = effectiveDeadline(c, now);
    const isRenewal = !deadline;
    const target = isRenewal ? renewalDeadline(c, now) : deadline;
    if (!target) continue;
    if (target.getTime() < now.getTime()) continue; // past (markOverdue handles)
    const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
    const cadence = cadenceFor(days, window);
    if (cadence === null) continue;

    // Dedupe: only send when this deadline has not been notified at this
    // cadence (or a stricter one) yet.
    const last = c.lastNotifiedCadence;
    if (last !== null && cadence >= last) continue;

    selected.push(c);
  }
  return selected;
}

/** Send notifications for the selected candidates (idempotent). */
export async function sendNotifications(candidates: Candidate[], now: Date = new Date()): Promise<SweepStats> {
  const window = notifyWindowDays();
  const stats: SweepStats = { selected: candidates.length, sent: 0, skipped: 0, failed: 0, items: [] };

  for (const c of candidates) {
    const deadline = effectiveDeadline(c, now);
    const isRenewal = !deadline;
    const target = isRenewal ? renewalDeadline(c, now) : deadline;
    if (!target) continue;
    const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
    const cadence = cadenceFor(days, window);
    if (cadence === null) {
      stats.skipped += 1;
      continue;
    }

    // Re-check the dedupe guard inside the loop (another instance may have
    // sent this while we were selecting).
    const item = await db.watchItem.findUnique({
      where: { id: c.watchItemId },
      select: { notifiedAt: true, status: true, lastNotifiedCadence: true },
    });
    if (!item || item.status === "resolved" || item.status === "dismissed") {
      stats.skipped += 1;
      continue;
    }
    if (item.lastNotifiedCadence !== null && cadence >= item.lastNotifiedCadence) {
      stats.skipped += 1;
      continue;
    }

    const deadlineLabel =
      !isRenewal && c.submissionDeadlineLabel
        ? c.submissionDeadlineLabel
        : target.toISOString().slice(0, 10);
    const daysLeft = Math.max(0, days);
    const dayText = dayBucket(daysLeft);
    const reason =
      days === 0
        ? "Due today"
        : `Renewal in ${dayText} day${dayText === 1 ? "" : "s"}`;
    const obligationPayload = {
      counterpartyName: c.counterpartyName,
      kind: c.kind ?? "other",
      amountCents: c.amountCents,
      currency: c.currency ?? "USD",
      exposureLowCents: c.exposureLowCents,
      exposureHighCents: c.exposureHighCents,
      exposureAssumption: c.exposureAssumption,
      dueDate: target,
      riskType: c.riskType,
    };
    const email = renewalReminderEmail({
      to: c.userEmail!,
      watchItemId: c.watchItemId,
      obligation: obligationPayload,
      deadlineLabel,
      daysLeft,
      reason,
      unwatchUrl: `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/api/unwatch/${createUnwatchToken(c.watchItemId)}`,
      watchlistUrl: `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/watchlist`,
    });

    const result = await sendEmail(email);
    const emailResult = result;
    console.log(`[wt14:debug] item=${c.watchItemId} delivered=${emailResult.delivered}`);

    // Lifecycle: advance open → upcoming → due. Resolution/dismissal stops
    // reminders forever (those statuses are excluded from selection).
    const nextStatus =
      item.status === "due" || days <= 1 ? "due" : "upcoming";
    const mark = db.watchItem.update({
      where: { id: c.watchItemId },
      data: { notifiedAt: now, lastNotifiedCadence: cadence, status: nextStatus },
    });
    const log = db.event.create({
      data: {
        userId: c.userId || null,
        obligationId: c.obligationId,
        type: "notified",
        detail: `deadline=${target.toISOString()} cadence=${cadence}d reason="${email.subject}"`,
      },
    });
    await db.$transaction([mark, log]);

    if (result.delivered) {
      stats.sent += 1;
      stats.items.push({ id: c.watchItemId, reason: email.subject });
    } else {
      stats.failed += 1;
    }
  }
  return stats;
}

/** Run the full sweep: select then send. */
export async function runSweep(now: Date = new Date()): Promise<SweepStats> {
  await markOverdue(now);
  const candidates = await selectCandidates(now);
  return sendNotifications(candidates, now);
}

/**
 * Initial watch status from a deadline (WT-14): already past → "due";
 * inside the notify window → "upcoming"; otherwise "open". Used when a watch
 * item is created so the lifecycle starts in the right state.
 */
export function initialStatusFromDeadline(deadline: Date | null | undefined, now: Date = new Date()): string {
  if (!deadline) return "open";
  const days = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return "due";
  if (inWindow(days)) return "upcoming";
  return "open";
}

/**
 * Mark items overdue (→ "due") when their deadline has passed and no email
 * is left to send, so the watchlist reflects reality without waiting for the
 * T-1 send. Idempotent; never touches resolved/dismissed items.
 */
export async function markOverdue(now: Date = new Date()): Promise<number> {
  const rows = await db.watchItem.findMany({
    where: { status: { in: ["open", "upcoming"] } },
    select: {
      id: true,
      deadline: true,
      lastNotifiedCadence: true,
      obligation: {
        select: {
          dueDate: true,
          renewalDate: true,
          noticeDeadlines: { select: { dueAt: true }, orderBy: { dueAt: "asc" } },
        },
      },
    },
  });
  let updated = 0;
  for (const r of rows) {
    const hard =
      r.deadline ??
      r.obligation.noticeDeadlines[0]?.dueAt ??
      r.obligation.dueDate;
    const past = hard ? hard.getTime() < now.getTime() : false;
    if (!past) continue;
    const last = r.lastNotifiedCadence;
    const sentOnTime = last !== null && last > 0; // any reminder was sent before the deadline
    if (sentOnTime) continue;
    await db.watchItem.update({ where: { id: r.id }, data: { status: "due" } });
    updated += 1;
  }
  return updated;
}
