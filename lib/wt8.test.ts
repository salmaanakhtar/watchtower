import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_DB = path.join(__dirname, `.wt8.test.${process.pid}.${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { encryptField, decryptField, hashForLookup } from "@/lib/crypto";
import {
  magicLinkOnCooldown,
  magicLinkRateExceeded,
  recordMagicLink,
  ipRateExceeded,
  _resetIpLimiterForTests,
} from "@/lib/rate-limit";
import { runRetention, RETENTION_DAYS } from "@/lib/retention";
import { POST as analysesPOST } from "@/app/api/analyses/route";
import { POST as authRequestPOST } from "@/app/api/auth/request/route";
import { GET as authVerifyGET } from "@/app/api/auth/verify/[token]/route";
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
  process.env.AUTH_SECRET = "test-auth-secret";
  process.env.AUTH_MAGIC_SECRET = "test-magic-secret";
  process.env.NOTIFY_STUB_SENDER = "1";
  process.env.APP_ORIGIN = "http://localhost:3000";
  _resetIpLimiterForTests();
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

describe("WT-8 encryption at rest", () => {
  it("stores user email encrypted + lookup hash (findUnique by hash works)", async () => {
    const email = "encrypted@example.com";
    await authRequestPOST(
      new Request("http://localhost/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
    const user = await db.user.findUnique({ where: { emailHash: hashForLookup(email) } });
    expect(user).toBeTruthy();
    expect(user!.email).not.toContain("encrypted@example.com");
    expect(decryptField(user!.email)).toBe(email);
    expect(user!.emailHash).toBe(hashForLookup(email));
  });

  it("stores submission content encrypted + consent recorded", async () => {
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.",
          variant: "A",
          kind: "paste",
          consent: true,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const sub = await db.submission.findUnique({ where: { id } });
    expect(sub!.consent).toBe(true);
    expect(sub!.consentAt).toBeTruthy();
    expect(sub!.content).not.toContain("Adobe");
    expect(decryptField(sub!.content)).toContain("Adobe");
    expect(decryptField(sub!.result)).toContain("subscription");
  });

  it("rejects analysis without consent (403)", async () => {
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Your Adobe plan renews on October 14 at $19.99/month.",
          variant: "A",
          kind: "paste",
          consent: false,
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("WT-8 rate limiting", () => {
  it("is scoped per email (two emails are independent)", async () => {
    _resetIpLimiterForTests();
    const a = `ratelimit-a-${Date.now()}@example.com`;
    const b = `ratelimit-b-${Date.now()}@example.com`;
    expect(await magicLinkOnCooldown(a)).toBe(false);
    await recordMagicLink(a);
    expect(await magicLinkOnCooldown(a)).toBe(true);
    expect(await magicLinkOnCooldown(b)).toBe(false);
  });

  it("enforces the hourly cap", async () => {
    const email = "ratelimit-cap@example.com";
    for (let i = 0; i < 5; i++) await recordMagicLink(email);
    expect(await magicLinkRateExceeded(email)).toBe(true);
  });

  it("limits anonymous analyses per IP", () => {
    _resetIpLimiterForTests();
    for (let i = 0; i < 20; i++) expect(ipRateExceeded("1.2.3.4")).toBe(false);
    expect(ipRateExceeded("1.2.3.4")).toBe(true);
    expect(ipRateExceeded("5.6.7.8")).toBe(false);
  });
});

describe("WT-8 retention", () => {
  it("deletes unconsented submissions and anonymizes old unreferenced ones", async () => {
    // Unconsented submission (consent never true).
    const unconsented = await db.submission.create({
      data: { kind: "paste", content: encryptField("unconsented doc") ?? "", consent: false },
    });

    // Old, consented, unreferenced submission (past retention window).
    const old = await db.submission.create({
      data: {
        kind: "paste",
        content: encryptField("old doc content") ?? "",
        result: encryptField("{}"),
        analysis: encryptField("{}"),
        consent: true,
        createdAt: new Date(Date.now() - (RETENTION_DAYS + 1) * 86_400_000),
      },
    });

    const stats = await runRetention();

    expect(stats.deletedSubmissions).toBeGreaterThanOrEqual(1);
    expect(await db.submission.findUnique({ where: { id: unconsented.id } })).toBeNull();

    const oldRow = await db.submission.findUnique({ where: { id: old.id } });
    expect(oldRow).toBeTruthy();
    expect(oldRow!.content).toBe("");
    expect(oldRow!.result).toBeNull();

    // A watched old submission must survive intact.
    const watched = await db.submission.create({
      data: {
        kind: "paste",
        content: encryptField("watched doc") ?? "",
        consent: true,
        createdAt: new Date(Date.now() - (RETENTION_DAYS + 1) * 86_400_000),
        status: "done",
        result: encryptField("{}"),
      },
    });
    const doc = await db.document.create({
      data: { source: "paste", extractedText: encryptField("watched text")!, submissionId: watched.id },
    });
    const user = await db.user.create({
      data: { emailHash: hashForLookup(`retention-watched-${Date.now()}@example.com`) },
    });
    const obligation = await db.obligation.create({
      data: { documentId: doc.id, userId: user.id, kind: "subscription", counterpartyName: "Acme" },
    });
    await db.watchItem.create({ data: { userId: user.id, obligationId: obligation.id } });

    const stats2 = await runRetention();
    const watchedRow = await db.submission.findUnique({ where: { id: watched.id } });
    expect(watchedRow!.content).not.toBe("");
    expect(decryptField(watchedRow!.content)).toContain("watched");
    expect(stats2.deletedSubmissions).toBe(0);
  });
});

describe("WT-8 audit log", () => {
  it("records auth failures and successes", async () => {
    const before = await db.auditLog.count();
    await authVerifyGET(
      new Request("http://localhost/api/auth/verify/bad.token", { headers: { Cookie: "" } }),
      { params: Promise.resolve({ token: "bad.token" }) },
    );
    const after = await db.auditLog.count();
    expect(after).toBeGreaterThan(before);
    const latest = await db.auditLog.findFirst({ orderBy: { createdAt: "desc" } });
    expect(latest!.action).toBe("auth_verify_failed");
  });
});
