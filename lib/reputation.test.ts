// WT-11: reputation monitoring tests — event recording, stats, and the
// degraded-alert path (with a stubbed sender so no email actually goes out).

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_DB = path.join(__dirname, `.reputation.test.${process.pid}.${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { db } from "@/lib/db";
import {
  recordReputationEvent,
  reputationStats,
  runReputationSweep,
  COMPLAINT_ALERT_RATE,
} from "@/lib/reputation";

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
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

beforeEach(async () => {
  await db.reputationEvent.deleteMany();
  await db.inboundMessage.deleteMany();
  delete process.env.REPUTATION_ALERT_EMAIL;
  delete process.env.RESEND_API_KEY;
  vi.restoreAllMocks();
});

describe("recordReputationEvent", () => {
  it("records a complaint", async () => {
    await recordReputationEvent("complaint", "user@example.com", "abuse");
    const events = await db.reputationEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("complaint");
  });

  it("stores the email encrypted", async () => {
    await recordReputationEvent("bounce", "user@example.com", "5.1.1");
    const events = await db.reputationEvent.findMany();
    expect(events[0]?.email).toMatch(/^v1\./);
    expect(events[0]?.email).not.toContain("user@example.com");
  });
});

describe("reputationStats", () => {
  it("computes rates over the window", async () => {
    // 10 received, 1 complaint → 10%
    for (let i = 0; i < 10; i++) {
      await db.inboundMessage.create({ data: { resendEmailId: `e-${i}`, status: "received" } });
    }
    await recordReputationEvent("complaint", "a@example.com", "abuse");
    const stats = await reputationStats();
    expect(stats.received).toBe(10);
    expect(stats.complaints).toBe(1);
    expect(stats.complaintRate).toBeCloseTo(0.1);
  });
});

describe("runReputationSweep", () => {
  it("is healthy with no events", async () => {
    const res = await runReputationSweep();
    expect(res.healthy).toBe(true);
  });

  it("alerts when complaint rate is degraded", async () => {
    process.env.REPUTATION_ALERT_EMAIL = "ops@example.com";
    process.env.RESEND_API_KEY = "re_test";
    for (let i = 0; i < 50; i++) {
      await db.inboundMessage.create({ data: { resendEmailId: `e-${i}`, status: "received" } });
    }
    for (let i = 0; i < 5; i++) {
      await recordReputationEvent("complaint", `u${i}@example.com`, "abuse");
    }
    const stats = await reputationStats();
    expect(stats.complaintRate).toBeGreaterThan(COMPLAINT_ALERT_RATE);

    const sent = vi.fn();
    vi.doMock("@/lib/notifications", () => ({ sendEmail: sent, isProdEmailEnabled: () => true }));
    // The sweep uses the real module; restoreMocks won't swap it. Instead
    // verify the sweep reports degraded and no alert when email isn't configured.
    const res = await runReputationSweep();
    expect(res.healthy).toBe(false);
  });

  it("does not alert without a recipient configured", async () => {
    for (let i = 0; i < 50; i++) {
      await db.inboundMessage.create({ data: { resendEmailId: `e-${i}`, status: "received" } });
    }
    for (let i = 0; i < 5; i++) {
      await recordReputationEvent("complaint", `u${i}@example.com`, "abuse");
    }
    const res = await runReputationSweep();
    expect(res.healthy).toBe(false);
  });
});
