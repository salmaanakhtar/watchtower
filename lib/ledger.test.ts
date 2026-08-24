import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_DB = path.join(__dirname, `.ledger.test.${process.pid}.${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import {
  recordLedgerEntry,
  recordPreventedFromObligation,
  projectedAmountForCategory,
  ledgerEntryInputSchema,
} from "@/lib/ledger";
import { GET as ledgerGET } from "@/app/api/ledger/route";
import { POST as ledgerPOST } from "@/app/api/ledger/route";
import { POST as analysesPOST } from "@/app/api/analyses/route";
import { POST as authRequestPOST } from "@/app/api/auth/request/route";
import { GET as authVerifyGET } from "@/app/api/auth/verify/[token]/route";
import { PATCH as watchPATCH } from "@/app/api/watch/[id]/route";
import { POST as watchPOST } from "@/app/api/watch/route";
import { parseSessionToken } from "@/lib/auth";
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
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

async function analyze(content: string) {
  const res = await analysesPOST(
    new Request("http://localhost/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, variant: "A", kind: "paste", consent: true }),
    }),
  );
  return res.json();
}

let counter = 0;
function uniqueEmail(base = "ledger"): string {
  counter += 1;
  return `${base}${counter}_${Date.now()}@example.com`;
}

async function signInAndGetCookie(email: string) {
  const req = await authRequestPOST(
    new Request("http://localhost/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  const { token } = await req.json();
  const verify = await authVerifyGET(
    new Request(`http://localhost/api/auth/verify/${token}`, { headers: { Cookie: "" } }),
    { params: Promise.resolve({ token }) },
  );
  const setCookie = verify.headers.get("set-cookie") ?? "";
  const session = setCookie.match(/wt_session=([^;]+)/)?.[1] ?? "";
  return `wt_session=${encodeURIComponent(session)}`;
}

async function analyzedObligation(content: string) {
  const json = await analyze(content);
  return json.obligation;
}

function sessionUserId(cookie: string): string {
  const token = cookie.match(/wt_session=([^;]+)/)?.[1] ?? "";
  return parseSessionToken(decodeURIComponent(token)) ?? "";
}

/**
 * Sign in + analyze a document, then attach the obligation to the user via a
 * watch item (the same flow as the real product), so the obligation is owned
 * by the user through the WatchItem.
 */
async function ownedObligation(content: string) {
  const email = uniqueEmail();
  const cookie = await signInAndGetCookie(email);
  const userId = sessionUserId(cookie);
  const obligation = await analyzedObligation(content);
  await watchPOST(
    new Request("http://localhost/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ obligationId: obligation.id }),
    }),
  );
  return { email, cookie, userId, obligation };
}

describe("projectedAmountForCategory (WT-13 strict definitions)", () => {
  it("prevented uses the low exposure bound, never the high bound", () => {
    expect(
      projectedAmountForCategory(
        { kind: "subscription", riskType: "auto_renewal", amountCents: 1999, exposureLowCents: 10000, exposureHighCents: 24000 },
        "prevented",
      ),
    ).toBe(10000);
  });

  it("prevented falls back to the unit amount when no exposure is present", () => {
    expect(
      projectedAmountForCategory(
        { kind: "subscription", riskType: "auto_renewal", amountCents: 1999, exposureLowCents: null, exposureHighCents: null },
        "prevented",
      ),
    ).toBe(1999);
  });

  it("prevented returns null when no amount is known", () => {
    expect(
      projectedAmountForCategory(
        { kind: "other", riskType: null, amountCents: null, exposureLowCents: null, exposureHighCents: null },
        "prevented",
      ),
    ).toBeNull();
  });

  it("avoided uses the realized unit amount", () => {
    expect(
      projectedAmountForCategory(
        { kind: "bill", riskType: "incorrect_charge", amountCents: 4500, exposureLowCents: 1200, exposureHighCents: 1200 },
        "avoided",
      ),
    ).toBe(4500);
  });

  it("recovered is never derived from the obligation (user supplies the amount)", () => {
    expect(
      projectedAmountForCategory(
        { kind: "refund", riskType: "refund_due", amountCents: 9900, exposureLowCents: 9900, exposureHighCents: 9900 },
        "recovered",
      ),
    ).toBeNull();
  });
});

describe("recordLedgerEntry (idempotence + traceability)", () => {
  it("records an entry and is idempotent per (user, obligation, category)", async () => {
    const { userId, obligation } = await ownedObligation("Your Adobe plan renews October 14 at $19.99/month.");

    const first = await recordLedgerEntry(userId, {
      obligationId: obligation.id,
      category: "recovered",
      amountCents: 5000,
      note: "Refund from Adobe support",
      source: "manual",
      verification: "verified",
    });
    expect(first.created).toBe(true);
    expect(first.entry.amountCents).toBe(5000);

    const again = await recordLedgerEntry(userId, {
      obligationId: obligation.id,
      category: "recovered",
      amountCents: 5000,
      source: "manual",
      verification: "verified",
    });
    expect(again.created).toBe(false);
    expect(again.entry.id).toBe(first.entry.id);

    const rows = await db.ledgerEntry.count({ where: { obligationId: obligation.id, category: "recovered" } });
    expect(rows).toBe(1);
  });

  it("rejects an invalid category and a zero/negative amount via the schema", () => {
    expect(
      ledgerEntryInputSchema.safeParse({
        obligationId: "o1",
        category: "prevented",
        amountCents: -1,
      }).success,
    ).toBe(false);
    expect(
      ledgerEntryInputSchema.safeParse({
        obligationId: "o1",
        category: "prevented",
        amountCents: 0,
      }).success,
    ).toBe(false);
    expect(
      ledgerEntryInputSchema.safeParse({
        obligationId: "o1",
        category: "guessed",
        amountCents: 100,
      }).success,
    ).toBe(false);
    expect(
      ledgerEntryInputSchema.safeParse({
        obligationId: "o1",
        category: "prevented",
        amountCents: 100,
      }).success,
    ).toBe(true);
  });
});

describe("recordPreventedFromObligation (resolve flow)", () => {
  it("records prevented from the obligation's low exposure", async () => {
    const { userId, obligation } = await ownedObligation("Your Adobe plan renews October 14 at $19.99/month.");
    const result = await recordPreventedFromObligation(userId, obligation.id, "Cancelled");
    expect(result.reason).toBe("ok");
    expect(result.created).toBe(true);
    expect(result.entry?.category).toBe("prevented");
    expect(result.entry?.amountCents).toBeGreaterThan(0);
  });

  it("is idempotent — a second resolve does not double count", async () => {
    const { userId, obligation } = await ownedObligation("Your Adobe plan renews October 14 at $19.99/month.");
    await recordPreventedFromObligation(userId, obligation.id);
    const second = await recordPreventedFromObligation(userId, obligation.id);
    expect(second.created).toBe(false);
  });

  it("returns not-found for obligations the user does not own", async () => {
    const email = uniqueEmail();
    const cookie = await signInAndGetCookie(email);
    const userId = sessionUserId(cookie);
    const result = await recordPreventedFromObligation(userId, "does-not-exist", "x");
    expect(result.reason).toBe("not-found");
  });
});

describe("GET /api/ledger + POST /api/ledger (WT-13)", () => {
  it("requires a session", async () => {
    const res = await ledgerGET(new Request("http://localhost/api/ledger"));
    expect(res.status).toBe(401);
  });

  it("returns the summary and entries for the signed-in user", async () => {
    const { cookie, obligation } = await ownedObligation("Your Adobe plan renews October 14 at $19.99/month.");

    const post = await ledgerPOST(
      new Request("http://localhost/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          obligationId: obligation.id,
          category: "recovered",
          amountCents: 2500,
          note: "Got a partial refund",
        }),
      }),
    );
    expect(post.status).toBe(201);

    const res = await ledgerGET(new Request("http://localhost/api/ledger", { headers: { Cookie: cookie } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ledger.recoveredCents).toBe(2500);
    expect(json.ledger.totalCents).toBe(2500);
    expect(json.ledger.entries).toHaveLength(1);
    expect(json.ledger.entries[0].obligation.id).toBe(obligation.id);
  });

  it("rejects recording against another user's obligation", async () => {
    const emailA = uniqueEmail("owner");
    await signInAndGetCookie(emailA);
    const obligation = await analyzedObligation("Your Adobe plan renews October 14 at $19.99/month.");
    const cookieB = await signInAndGetCookie(uniqueEmail("intruder"));

    const res = await ledgerPOST(
      new Request("http://localhost/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({
          obligationId: obligation.id,
          category: "recovered",
          amountCents: 100,
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects a negative amount", async () => {
    const email = uniqueEmail();
    const cookie = await signInAndGetCookie(email);
    const obligation = await analyzedObligation("Your Adobe plan renews October 14 at $19.99/month.");
    const res = await ledgerPOST(
      new Request("http://localhost/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          obligationId: obligation.id,
          category: "prevented",
          amountCents: -5,
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("resolve via PATCH records a prevented entry", async () => {
    const email = uniqueEmail();
    const cookie = await signInAndGetCookie(email);
    const obligation = await analyzedObligation("Your Adobe plan renews October 14 at $19.99/month.");
    const { watchItem } = await (
      await watchPOST(
        new Request("http://localhost/api/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ obligationId: obligation.id }),
        }),
      )
    ).json();

    const patch = await watchPATCH(
      new Request(`http://localhost/api/watch/${watchItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ status: "resolved", note: "Cancelled it" }),
      }),
      { params: Promise.resolve({ id: watchItem.id }) },
    );
    expect(patch.status).toBe(200);
    const patchJson = await patch.json();
    expect(patchJson.ledgerCreated).toBe(true);
    expect(patchJson.ledgerEntry.category).toBe("prevented");

    const res = await ledgerGET(new Request("http://localhost/api/ledger", { headers: { Cookie: cookie } }));
    const json = await res.json();
    expect(json.ledger.preventedCents).toBeGreaterThan(0);
    expect(json.ledger.entries[0].obligation.id).toBe(obligation.id);
  });
});
