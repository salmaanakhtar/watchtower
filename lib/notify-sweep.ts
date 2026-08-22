// WT-6: deadline notification sweep.
//
// Selects watch items that need a reminder and sends one email per item per
// deadline. Selection rules (PHASE0_1_PLAN §5.4 + WT-6 scope):
//   - item not resolved/dismissed
//   - obligation passes the alert gate (verification=certain, confidence ≥ 0.9)
//   - a deadline can be determined (WatchItem.deadline, Obligation.dueDate,
//     or the legacy human-readable label in Submission.result)
//   - the deadline is within the notify window (default 7/3/1 days out)
//   - never already notified for this deadline (notifiedAt guard)
//
// Idempotence: dedupe is enforced transactionally — the sweep marks
// notifiedAt + writes an Event row per send inside a transaction, and
// re-running it skips items already marked. Notified items stay selected when
// they re-enter the window at a tighter cadence (1 day), so a 7-day item gets
// at most 3 emails: 7d → 3d → 1d.

import { db } from "@/lib/db";
import { sendEmail, createUnwatchToken, deadlineEmail, parseDeadline } from "@/lib/notifications";

/** Notify at 7, 3, and 1 day(s) before the deadline. */
export const NOTIFY_WINDOW_DAYS = [7, 3, 1] as const;

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
  watchDeadline: Date | null;
  notifiedAt: Date | null;
  userEmail: string | null;
  submissionDeadlineLabel: string | null;
}

export function windowDaysFor(daysLeft: number): number[] {
  return NOTIFY_WINDOW_DAYS.filter((d) => daysLeft <= d);
}

/** Effective deadline for an item: WatchItem.deadline > Obligation.dueDate > legacy label. */
export function effectiveDeadline(c: Candidate): Date | null {
  return c.watchDeadline ?? c.dueDate ?? (c.submissionDeadlineLabel ? parseDeadline(c.submissionDeadlineLabel) : null);
}

/** Select watch items that need a notification today. */
export async function selectCandidates(now: Date = new Date()): Promise<Candidate[]> {
  const rows = await db.watchItem.findMany({
    where: { status: { in: ["open", "upcoming", "due"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      status: true,
      deadline: true,
      notifiedAt: true,
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
          user: { select: { email: true } },
          document: { select: { submissionId: true } },
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

    // Alert gate: certain + confidence ≥ 0.9 (PHASE0_1_PLAN §5.4).
    if (o.verification !== "certain" || (o.confidence ?? 0) < 0.9) continue;
    if (!o.user?.email) continue;

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
      watchDeadline: r.deadline,
      notifiedAt: r.notifiedAt,
      userEmail: o.user.email,
      submissionDeadlineLabel: label,
    });
  }

  const selected: Candidate[] = [];
  for (const c of candidates) {
    const deadline = effectiveDeadline(c);
    if (!deadline) continue;
    const days = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
    if (days < 0) continue; // overdue: skip until a resolve sweep lands
    const window = windowDaysFor(days);
    if (window.length === 0) continue;

    // Dedupe: only send when this item has not been notified at this cadence
    // (or closer) yet. notifiedAt = the last send; re-notify when the new
    // window is strictly tighter than the cadence at last send.
    const last = c.notifiedAt ? Math.ceil((deadline.getTime() - c.notifiedAt.getTime()) / 86_400_000) : null;
    if (last !== null && !window.some((d) => d < last)) continue;

    selected.push(c);
  }
  return selected;
}

/** Send notifications for the selected candidates (idempotent). */
export async function sendNotifications(candidates: Candidate[], now: Date = new Date()): Promise<SweepStats> {
  const stats: SweepStats = { selected: candidates.length, sent: 0, skipped: 0, failed: 0, items: [] };

  for (const c of candidates) {
    const deadline = effectiveDeadline(c);
    if (!deadline) continue;

    // Re-check the dedupe guard inside the loop (another instance may have
    // sent this while we were selecting).
    const item = await db.watchItem.findUnique({
      where: { id: c.watchItemId },
      select: { notifiedAt: true, status: true },
    });
    if (!item || item.status === "resolved" || item.status === "dismissed") {
      stats.skipped += 1;
      continue;
    }
    const days = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
    const window = windowDaysFor(days);
    const last = item.notifiedAt ? Math.ceil((deadline.getTime() - item.notifiedAt.getTime()) / 86_400_000) : null;
    if (last !== null && !window.some((d) => d < last)) {
      stats.skipped += 1;
      continue;
    }

    const deadlineLabel = c.submissionDeadlineLabel ?? deadline.toISOString().slice(0, 10);
    const daysLeft = Math.max(0, days);
    const email = deadlineEmail({
      to: c.userEmail!,
      watchItemId: c.watchItemId,
      obligation: {
        counterpartyName: c.counterpartyName,
        kind: c.kind ?? "other",
        amountCents: c.amountCents,
        currency: c.currency ?? "USD",
        exposureLowCents: c.exposureLowCents,
        exposureHighCents: c.exposureHighCents,
        exposureAssumption: c.exposureAssumption,
        dueDate: deadline,
        riskType: c.riskType,
      },
      deadlineLabel,
      daysLeft,
      reason: days === 0 ? "Due today" : `Renewal in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      unwatchUrl: `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/api/unwatch/${createUnwatchToken(c.watchItemId)}`,
      watchlistUrl: `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/watchlist`,
    });

    const result = await sendEmail(email);
    const mark = db.watchItem.update({
      where: { id: c.watchItemId },
      data: { notifiedAt: now, status: "upcoming" },
    });
    const log = db.event.create({
      data: {
        userId: c.userId || null,
        obligationId: c.obligationId,
        type: "notified",
        detail: `deadline=${deadline.toISOString()} reason="${email.subject}"`,
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
  const candidates = await selectCandidates(now);
  return sendNotifications(candidates, now);
}
