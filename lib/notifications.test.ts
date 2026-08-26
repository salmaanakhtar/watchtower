// WT-6/WT-14: unit tests for deadline parsing, the alert gate, templates,
// unwatch tokens, and the notification sweep (selection + lifecycle +
// dedupe + renewal reminders). Uses the same throwaway-DB pattern as
// lib/watch.test.ts so sweep selection runs against real canonical rows.

import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_DB = path.join(__dirname, `.notify.test.${process.pid}.${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import {
  ALERT_GATE,
  canAlert,
  createUnwatchToken,
  deadlineEmail,
  deadlineReason,
  daysUntil,
  isProdEmailEnabled,
  magicLinkEmail,
  parseDeadline,
  parseUnwatchToken,
  renewalReminderEmail,
  sendEmail,
} from "@/lib/notifications";
import {
  selectCandidates,
  sendNotifications,
  effectiveDeadline,
  initialStatusFromDeadline,
  markOverdue,
  notifyWindowDays,
  cadenceFor,
  renewalDeadline,
  inWindow,
} from "@/lib/notify-sweep";
import { db } from "@/lib/db";

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
  execSync(`node "${path.join(REPO_ROOT, "node_modules", "prisma", "build", "index.js")}" migrate deploy`, {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
  process.env.AUTH_MAGIC_SECRET = "test-magic-secret";
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.NOTIFY_WINDOW_DAYS;
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

beforeEach(async () => {
  // Isolate tests: each test starts from an empty canonical set. Children
  // referencing obligation must be cleared before the obligations themselves.
  await db.noticeDeadline.deleteMany();
  await db.ledgerEntry.deleteMany();
  await db.watchItem.deleteMany();
  await db.event.deleteMany();
  await db.obligation.deleteMany();
  await db.document.deleteMany();
  await db.submission.deleteMany();
  await db.user.deleteMany();
  await db.payment.deleteMany();
  await db.company.deleteMany();
  await db.provenanceFact.deleteMany();
});

const FIXED_NOW = new Date("2026-08-22T12:00:00.000Z"); // Saturday, Aug 22 2026

function daysFromNow(days: number): Date {
  return new Date(FIXED_NOW.getTime() + days * 86_400_000);
}

/** Create a user + a certain, high-confidence obligation + watch item. */
async function makeWatch({
  deadlineDays,
  renewalDays = null,
  kind = "subscription",
  verification = "certain",
  confidence = 0.92,
  status = "open",
  notifiedDaysAgo = null,
  notifiedCadence = null,
  noticeDeadlineDays = null,
}: {
  deadlineDays: number | null;
  renewalDays?: number | null;
  kind?: string;
  verification?: string;
  confidence?: number;
  status?: string;
  notifiedDaysAgo?: number | null;
  notifiedCadence?: number | null;
  noticeDeadlineDays?: number | null;
}) {
  const user = await db.user.create({
    data: { email: `sweep-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, anonymous: false },
  });
  const obligation = await db.obligation.create({
    data: {
      kind,
      counterpartyName: "Adobe",
      amountCents: 23988,
      currency: "USD",
      riskType: "auto_renewal",
      exposureLowCents: 23988,
      exposureHighCents: 23988,
      dueDate: deadlineDays === null ? null : daysFromNow(deadlineDays),
      renewalDate: renewalDays === null ? null : daysFromNow(renewalDays),
      verification,
      confidence,
      status: "open",
      userId: user.id,
    },
  });
  const watchItem = await db.watchItem.create({
    data: {
      userId: user.id,
      obligationId: obligation.id,
      status,
      deadline: deadlineDays === null ? null : daysFromNow(deadlineDays),
      notifiedAt: notifiedDaysAgo === null ? null : daysFromNow(-notifiedDaysAgo),
      lastNotifiedCadence: notifiedCadence,
    },
  });
  if (noticeDeadlineDays !== null) {
    await db.noticeDeadline.create({
      data: { obligationId: obligation.id, kind: "notice", dueAt: daysFromNow(noticeDeadlineDays) },
    });
  }
  return { user, obligation, watchItem };
}

describe("parseDeadline", () => {
  it("parses the legacy engine label ('October 14')", () => {
    const d = parseDeadline("October 14", new Date("2026-08-22T00:00:00Z"));
    expect(d?.getUTCMonth()).toBe(9);
    expect(d?.getUTCDate()).toBe(14);
    expect(d?.getUTCFullYear()).toBe(2026);
  });
  it("anchors a past month-day to next year", () => {
    const d = parseDeadline("January 5", new Date("2026-08-22T00:00:00Z"));
    expect(d?.getUTCFullYear()).toBe(2027);
  });
  it("parses ISO dates", () => {
    const d = parseDeadline("2026-10-14", new Date("2026-08-22T00:00:00Z"));
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCMonth()).toBe(9);
  });
  it("parses MM/DD/YYYY", () => {
    const d = parseDeadline("10/14/2026", new Date("2026-08-22T00:00:00Z"));
    expect(d?.getUTCMonth()).toBe(9);
    expect(d?.getUTCDate()).toBe(14);
  });
  it("returns null for garbage", () => {
    expect(parseDeadline("someday soon")).toBeNull();
    expect(parseDeadline(null)).toBeNull();
    expect(parseDeadline("")).toBeNull();
  });
});

describe("daysUntil / deadlineReason", () => {
  it("computes whole days", () => {
    expect(daysUntil("October 14", new Date("2026-10-01T00:00:00Z"))).toBe(13);
    expect(daysUntil("October 14", new Date("2026-10-14T00:00:00Z"))).toBe(0);
    expect(daysUntil(null, FIXED_NOW)).toBeNull();
  });
  it("builds the notification reason string", () => {
    expect(deadlineReason("October 14", new Date("2026-10-07T00:00:00Z"))?.reason).toBe(
      "Renewal in 7 days",
    );
    expect(deadlineReason("October 14", new Date("2026-10-14T00:00:00Z"))?.reason).toBe("Due today");
  });
});

describe("alert gate (PHASE0_1_PLAN §5.4)", () => {
  it("only alerts verification=certain at confidence >= 0.9", () => {
    expect(ALERT_GATE.verification).toBe("certain");
    expect(ALERT_GATE.confidence).toBe(0.9);
    expect(canAlert({ verification: "certain", confidence: 0.92 })).toBe(true);
    expect(canAlert({ verification: "certain", confidence: 0.89 })).toBe(false);
    expect(canAlert({ verification: "conditional", confidence: 0.95 })).toBe(false);
    expect(canAlert({ verification: "hypothetical", confidence: 0.5 })).toBe(false);
    expect(canAlert(null)).toBe(false);
    expect(canAlert(undefined)).toBe(false);
  });
});

describe("unwatch tokens", () => {
  it("round-trips", () => {
    const token = createUnwatchToken("item_1");
    expect(parseUnwatchToken(token)).toBe("item_1");
    expect(parseUnwatchToken("garbage")).toBeNull();
  });
  it("rejects tampered tokens", () => {
    const token = createUnwatchToken("item_2");
    const [body, sig] = token.split(".");
    const tampered = `${body}${"x".repeat(2)}.${sig}`;
    expect(parseUnwatchToken(tampered)).toBeNull();
  });
});

describe("email templates", () => {
  it("magicLinkEmail builds an absolute verify link", () => {
    process.env.APP_ORIGIN = "https://watchtower.salmaan.dev";
    const m = magicLinkEmail("a@b.com", "tok123");
    expect(m.to).toBe("a@b.com");
    expect(m.text).toContain("https://watchtower.salmaan.dev/api/auth/verify/tok123");
    expect(m.html).toContain("watchtower.salmaan.dev/api/auth/verify/tok123");
    delete process.env.APP_ORIGIN;
  });

  it("deadlineEmail is plain-text-first with one finding", () => {
    const m = deadlineEmail({
      to: "a@b.com",
      watchItemId: "w1",
      obligation: {
        counterpartyName: "Adobe",
        kind: "subscription",
        amountCents: 23988,
        currency: "USD",
        exposureLowCents: 23988,
        exposureHighCents: 23988,
        exposureAssumption: null,
        dueDate: new Date("2026-10-14"),
        riskType: "auto_renewal",
      },
      deadlineLabel: "October 14",
      daysLeft: 7,
      reason: "Renewal in 7 days",
      unwatchUrl: "https://x.dev/api/unwatch/tok",
      watchlistUrl: "https://x.dev/watchlist",
    });
    expect(m.subject).toContain("Adobe");
    expect(m.subject).toContain("October 14");
    expect(m.text).toContain("Renewal in 7 days");
    expect(m.text).toContain("$240");
    expect(m.text).toContain("/api/unwatch/tok");
    expect(m.text).toContain("You're getting this because you asked Watchtower to watch this item");
    expect(m.html).toContain("/api/unwatch/tok");
  });

  it("sendEmail no-ops without a provider key", async () => {
    const result = await sendEmail(magicLinkEmail("a@b.com", "t"));
    expect(result.delivered).toBe(true);
    expect(result.providerId).toBeNull();
    expect(result.message.subject).toContain("Sign in");
  });

  it("renewalReminderEmail is plain-text-first with a renewal line", () => {
    const m = renewalReminderEmail({
      to: "a@b.com",
      watchItemId: "w2",
      obligation: {
        counterpartyName: "Adobe",
        kind: "subscription",
        amountCents: 23988,
        currency: "USD",
        exposureLowCents: 23988,
        exposureHighCents: 23988,
        exposureAssumption: null,
        dueDate: null,
        riskType: "auto_renewal",
      },
      deadlineLabel: "2026-10-14",
      daysLeft: 7,
      reason: "Renewal in 7 days",
      unwatchUrl: "https://x.dev/api/unwatch/tok",
      watchlistUrl: "https://x.dev/watchlist",
    });
    expect(m.subject).toContain("Adobe");
    expect(m.subject).toContain("2026-10-14");
    expect(m.text).toContain("Renewal in 7 days");
    expect(m.text).toContain("Next renewal: 2026-10-14");
    expect(m.text).toContain("$240");
    expect(m.text).toContain("/api/unwatch/tok");
    expect(m.html).toContain("Next renewal");
  });

  it("isProdEmailEnabled is false without keys", () => {
    expect(isProdEmailEnabled()).toBe(false);
  });
});

describe("notification sweep selection (WT-14)", () => {
  it("selects due items within the T-7 / T-1 window", async () => {
    const a = await makeWatch({ deadlineDays: 5 }); // inside 7
    const b = await makeWatch({ deadlineDays: 2 }); // inside 7
    const c = await makeWatch({ deadlineDays: 1 }); // inside 1
    const d = await makeWatch({ deadlineDays: 20 }); // outside
    const candidates = await selectCandidates(FIXED_NOW);
    const ids = candidates.map((c) => c.watchItemId);
    expect(ids).toContain(a.watchItem.id);
    expect(ids).toContain(b.watchItem.id);
    expect(ids).toContain(c.watchItem.id);
    expect(ids).not.toContain(d.watchItem.id);
  });

  it("selects renewal-based items (no hard deadline) inside the window", async () => {
    await makeWatch({ deadlineDays: null, renewalDays: 5 });
    const candidates = await selectCandidates(FIXED_NOW);
    expect(candidates.length).toBe(1);
    const hit = candidates[0];
    expect(effectiveDeadline(hit!)).toBeNull();
    expect(renewalDeadline(hit!)).not.toBeNull();
  });

  it("does not select a non-recurring obligation without a hard deadline", async () => {
    await makeWatch({ deadlineDays: null, renewalDays: 5, kind: "bill" });
    const candidates = await selectCandidates(FIXED_NOW);
    expect(candidates.length).toBe(0);
  });

  it("skips conditional/low-confidence and resolved/dismissed items", async () => {
    await makeWatch({ deadlineDays: 5, verification: "conditional", confidence: 0.95 });
    await makeWatch({ deadlineDays: 5, verification: "certain", confidence: 0.5 });
    await makeWatch({ deadlineDays: 5, status: "resolved" });
    await makeWatch({ deadlineDays: 5, status: "dismissed" });
    const candidates = await selectCandidates(FIXED_NOW);
    expect(candidates.length).toBe(0);
  });

  it("uses the legacy submission deadline label when dates are null", async () => {
    const user = await db.user.create({
      data: { email: `legacy-${Date.now()}@example.com`, anonymous: false },
    });
    const submission = await db.submission.create({
      data: {
        variant: "A",
        kind: "paste",
        contentType: "text/plain",
        content: "x",
        result: JSON.stringify({ deadline: "October 14" }),
        status: "done",
      },
    });
    const doc = await db.document.create({
      data: {
        source: "paste",
        contentType: "text/plain",
        extractedText: "x",
        submissionId: submission.id,
      },
    });
    const obligation = await db.obligation.create({
      data: {
        kind: "subscription",
        counterpartyName: "Adobe",
        verification: "certain",
        confidence: 0.95,
        status: "open",
        userId: user.id,
        documentId: doc.id,
        dueDate: null,
      },
    });
    const watchItem = await db.watchItem.create({
      data: { userId: user.id, obligationId: obligation.id, status: "open", deadline: null },
    });
    const candidates = await selectCandidates(new Date("2026-10-07T00:00:00Z"));
    const hit = candidates.find((c) => c.watchItemId === watchItem.id);
    expect(hit).toBeTruthy();
    expect(hit?.submissionDeadlineLabel).toBe("October 14");
    expect(effectiveDeadline(hit!)).not.toBeNull();
  });

  it("does not notify an item already notified at the same cadence", async () => {
    await makeWatch({ deadlineDays: 5, notifiedCadence: 7 });
    const candidates = await selectCandidates(FIXED_NOW);
    expect(candidates.length).toBe(0);
  });

  it("re-notifies when a tighter window arrives (7d then 1d)", async () => {
    const { watchItem } = await makeWatch({ deadlineDays: 2, notifiedCadence: 7 });
    // Notified at 7 days. Still inside 7d but same cadence → skip until 1d.
    const before = await selectCandidates(FIXED_NOW);
    expect(before.find((c) => c.watchItemId === watchItem.id)).toBeFalsy();

    // At 1 day out, the 1d cadence is strictly tighter than the last (7) → select.
    const at1 = await selectCandidates(daysFromNow(1));
    expect(at1.find((c) => c.watchItemId === watchItem.id)).toBeTruthy();
  });

  it("picks the nearest future NoticeDeadline over obligation.dueDate", async () => {
    const user = await db.user.create({
      data: { email: `nd-${Date.now()}@example.com`, anonymous: false },
    });
    const obligation = await db.obligation.create({
      data: {
        kind: "subscription",
        counterpartyName: "Adobe",
        verification: "certain",
        confidence: 0.95,
        status: "open",
        userId: user.id,
        dueDate: daysFromNow(10),
      },
    });
    // No explicit watch deadline: the NoticeDeadline at 5 days must win over
    // obligation.dueDate at 10 days (watch deadline is deliberately null).
    const watchItem = await db.watchItem.create({
      data: { userId: user.id, obligationId: obligation.id, status: "open", deadline: null },
    });
    await db.noticeDeadline.create({
      data: { obligationId: obligation.id, kind: "notice", dueAt: daysFromNow(5) },
    });
    const candidates = await selectCandidates(FIXED_NOW);
    const hit = candidates.find((c) => c.watchItemId === watchItem.id);
    expect(hit).toBeTruthy();
    expect(hit!.noticeDeadlines.length).toBe(1);
    expect(hit!.noticeDeadlines[0]!.dueAt.getTime()).toBe(daysFromNow(5).getTime());
    expect(effectiveDeadline(hit!)?.getTime()).toBe(daysFromNow(5).getTime());
  });
});

describe("notify window / cadence (WT-14)", () => {
  it("defaults to T-7 and T-1", () => {
    expect(notifyWindowDays()).toEqual([7, 1]);
  });

  it("parses NOTIFY_WINDOW_DAYS env into a sorted window", () => {
    expect(notifyWindowDays({ NOTIFY_WINDOW_DAYS: "14,7,1" } as unknown as NodeJS.ProcessEnv)).toEqual([14, 7, 1]);
    expect(notifyWindowDays({ NOTIFY_WINDOW_DAYS: "" } as unknown as NodeJS.ProcessEnv)).toEqual([7, 1]);
    expect(notifyWindowDays({ NOTIFY_WINDOW_DAYS: "garbage" } as unknown as NodeJS.ProcessEnv)).toEqual([7, 1]);
  });

  it("computes the cadence for a days-left", () => {
    expect(cadenceFor(5)).toBe(7);
    expect(cadenceFor(1)).toBe(1);
    expect(cadenceFor(0)).toBe(1);
    expect(cadenceFor(-1)).toBeNull();
    expect(cadenceFor(20)).toBeNull();
    expect(inWindow(5)).toBe(true);
    expect(inWindow(8)).toBe(false);
  });
});

describe("watch lifecycle (WT-14)", () => {
  it("maps a deadline to the initial status", () => {
    expect(initialStatusFromDeadline(daysFromNow(5))).toBe("upcoming");
    expect(initialStatusFromDeadline(daysFromNow(-1))).toBe("due");
    expect(initialStatusFromDeadline(daysFromNow(20))).toBe("open");
    expect(initialStatusFromDeadline(null)).toBe("open");
  });

  it("markOverdue flags passed deadlines that were never reminded", async () => {
    const { watchItem } = await makeWatch({ deadlineDays: -2 });
    const updated = await markOverdue(FIXED_NOW);
    expect(updated).toBe(1);
    const marked = await db.watchItem.findUnique({ where: { id: watchItem.id } });
    expect(marked?.status).toBe("due");
  });

  it("markOverdue does not touch items that already got a reminder", async () => {
    await makeWatch({ deadlineDays: -2, notifiedCadence: 7 });
    const updated = await markOverdue(FIXED_NOW);
    expect(updated).toBe(0);
  });
});

describe("sendNotifications idempotence", () => {
  it("sends once, marks notifiedAt + cadence, and skips on a second run", async () => {
    const { watchItem } = await makeWatch({ deadlineDays: 5 });
    const first = await selectCandidates(FIXED_NOW);
    expect(first.length).toBeGreaterThan(0);
    const stats = await sendNotifications(first, FIXED_NOW);
    expect(stats.sent + stats.failed).toBe(1);

    const marked = await db.watchItem.findUnique({ where: { id: watchItem.id } });
    expect(marked?.notifiedAt).not.toBeNull();
    expect(marked?.lastNotifiedCadence).toBe(7);
    const events = await db.event.count({ where: { obligationId: marked?.obligationId, type: "notified" } });
    expect(events).toBe(1);

    const second = await selectCandidates(FIXED_NOW);
    expect(second.find((c) => c.watchItemId === watchItem.id)).toBeFalsy();
  });

  it("advances the lifecycle open → upcoming → due across cadences", async () => {
    const { watchItem } = await makeWatch({ deadlineDays: 2, status: "open" });

    // T-7-ish send (item is 2 days out, cadence 7): open → upcoming.
    const first = await selectCandidates(FIXED_NOW);
    expect(first.length).toBe(1);
    await sendNotifications(first, FIXED_NOW);
    let item = await db.watchItem.findUnique({ where: { id: watchItem.id } });
    expect(item?.status).toBe("upcoming");
    expect(item?.lastNotifiedCadence).toBe(7);

    // T-1 send (now 1 day out): upcoming → due.
    const second = await selectCandidates(daysFromNow(1));
    expect(second.find((c) => c.watchItemId === watchItem.id)).toBeTruthy();
    await sendNotifications(second, daysFromNow(1));
    item = await db.watchItem.findUnique({ where: { id: watchItem.id } });
    expect(item?.status).toBe("due");
    expect(item?.lastNotifiedCadence).toBe(1);
  });

  it("sends a renewal reminder for a no-deadline recurring item", async () => {
    const { watchItem } = await makeWatch({ deadlineDays: null, renewalDays: 5 });
    const candidates = await selectCandidates(FIXED_NOW);
    expect(candidates.length).toBe(1);
    const stats = await sendNotifications(candidates, FIXED_NOW);
    expect(stats.sent).toBe(1);

    const marked = await db.watchItem.findUnique({ where: { id: watchItem.id } });
    expect(marked?.lastNotifiedCadence).toBe(7);
    const events = await db.event.count({ where: { obligationId: watchItem.obligationId, type: "notified" } });
    expect(events).toBe(1);
    const event = await db.event.findFirst({ where: { obligationId: watchItem.obligationId, type: "notified" } });
    expect(event?.detail).toContain("Renewal in 7 days");
  });

  it("never sends to a resolved/dismissed item", async () => {
    const { watchItem } = await makeWatch({ deadlineDays: 5, status: "resolved" });
    const stats = await sendNotifications(await selectCandidates(FIXED_NOW), FIXED_NOW);
    expect(stats.sent).toBe(0);
    const item = await db.watchItem.findUnique({ where: { id: watchItem.id } });
    expect(item?.lastNotifiedCadence).toBeNull();
  });
});
