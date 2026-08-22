import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_DB = path.join(__dirname, `.auth.test.${process.pid}.${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import {
  createMagicToken,
  createSessionToken,
  parseMagicToken,
  parseSessionToken,
  sessionCookieValue,
} from "@/lib/auth";
import { POST as analysesPOST } from "@/app/api/analyses/route";
import { POST as authRequestPOST } from "@/app/api/auth/request/route";
import { GET as authVerifyGET } from "@/app/api/auth/verify/[token]/route";
import { GET as authMeGET } from "@/app/api/auth/me/route";
import { POST as watchPOST } from "@/app/api/watch/route";
import { GET as watchlistGET } from "@/app/api/watchlist/route";
import { PATCH as watchPATCH } from "@/app/api/watch/[id]/route";
import { db } from "@/lib/db";

beforeAll(() => {
  // Reset the DB for this run: the client opens the file lazily, so deleting
  // here guarantees a clean slate before migrate deploy + queries.
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
      body: JSON.stringify({ content, variant: "A", kind: "paste" }),
    }),
  );
  return res.json();
}

async function signInAndGetCookie(email = "watch@example.com") {
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

let testCounter = 0;
function uniqueEmail(base = "watch"): string {
  testCounter += 1;
  return `${base}${testCounter}_${Date.now()}@example.com`;
}

describe("auth tokens", () => {
  it("round-trips a session token", () => {
    const token = createSessionToken("user_1");
    expect(parseSessionToken(token)).toBe("user_1");
    expect(parseSessionToken("garbage")).toBeNull();
  });

  it("round-trips a magic token", () => {
    const token = createMagicToken("a@b.com");
    expect(parseMagicToken(token)?.email).toBe("a@b.com");
  });

  it("rejects expired tokens", () => {
    const expired = createSessionToken("user_1");
    expect(parseSessionToken(expired)).toBe("user_1");
    const body = expired.split(".")[0];
    const badSig = `${body}.aaaa`;
    expect(parseSessionToken(badSig)).toBeNull();
  });

  it("builds a cookie value", () => {
    expect(sessionCookieValue("abc")).toContain("wt_session=abc");
    expect(sessionCookieValue("abc")).toContain("HttpOnly");
    expect(sessionCookieValue("abc")).toContain("Max-Age=");
  });
});

describe("POST /api/auth/request", () => {
  it("creates a magic link token (dev mode returns it)", async () => {
    const res = await authRequestPOST(
      new Request("http://localhost/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "new@example.com" }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.delivered).toBe(true);
    expect(json.token).toBeTruthy();
  });

  it("rejects invalid email", async () => {
    const res = await authRequestPOST(
      new Request("http://localhost/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/verify/[token]", () => {
  it("sets a session cookie and redirects to /watchlist", async () => {
    const { token } = await (
      await authRequestPOST(
        new Request("http://localhost/api/auth/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "verify@example.com" }),
        }),
      )
    ).json();
    const res = await authVerifyGET(
      new Request(`http://localhost/api/auth/verify/${token}`, { headers: { Cookie: "" } }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/watchlist");
    expect(res.headers.get("set-cookie")).toContain("wt_session=");
  });

  it("rejects invalid tokens", async () => {
    const res = await authVerifyGET(
      new Request("http://localhost/api/auth/verify/bad.token", { headers: { Cookie: "" } }),
      { params: Promise.resolve({ token: "bad.token" }) },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("?auth=invalid");
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 without a session", async () => {
    const res = await authMeGET(new Request("http://localhost/api/auth/me"));
    expect(res.status).toBe(401);
  });

  it("returns the user with a session", async () => {
    const email = uniqueEmail("me");
    const cookie = await signInAndGetCookie(email);
    const res = await authMeGET(
      new Request("http://localhost/api/auth/me", { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe(email);
  });
});

describe("POST /api/watch + GET /api/watchlist (WT-5)", () => {
  it("requires a session to persist a watch", async () => {
    const { obligation } = await analyze("Your Adobe plan renews October 14 at $19.99/month.");
    const res = await watchPOST(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obligationId: obligation.id }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.needsAccount).toBe(true);
    expect(json.watchItem).toBeNull();
  });

  it("persists a watch for a signed-in user and lists it", async () => {
    const cookie = await signInAndGetCookie(uniqueEmail("watch2"));
    const { obligation } = await analyze("Your Adobe plan renews October 14 at $19.99/month.");

    const watch = await watchPOST(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ obligationId: obligation.id }),
      }),
    );
    expect(watch.status).toBe(201);
    const watchJson = await watch.json();
    expect(watchJson.needsAccount).toBe(false);
    expect(watchJson.watchItem.status).toBe("open");

    const list = await watchlistGET(
      new Request("http://localhost/api/watchlist", { headers: { Cookie: cookie } }),
    );
    expect(list.status).toBe(200);
    const listJson = await list.json();
    expect(listJson.watchItems.length).toBeGreaterThan(0);
    const item = listJson.watchItems[0];
    expect(item.obligation.counterpartyName).toContain("Adobe");
    expect(item.obligation.amountCents).toBe(23988);
    expect(item.status).toBe("open");
  });

  it("does not duplicate a watch (unique per user + obligation)", async () => {
    const cookie = await signInAndGetCookie(uniqueEmail("watch3"));
    const { obligation } = await analyze("Your Adobe plan renews October 14 at $19.99/month.");
    const first = await watchPOST(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ obligationId: obligation.id }),
      }),
    );
    const firstJson = await first.json();
    console.log("FIRST", JSON.stringify(firstJson));
    const again = await watchPOST(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ obligationId: obligation.id }),
      }),
    );
    const json = await again.json();
    expect(json.needsAccount).toBe(false);

    const list = await watchlistGET(
      new Request("http://localhost/api/watchlist", { headers: { Cookie: cookie } }),
    );
    const listJson = await list.json();
    const items = listJson.watchItems;
    expect(items.length).toBe(1);
    const obligationRows = await db.watchItem.count({
      where: { obligationId: obligation.id },
    });
    expect(obligationRows).toBe(1);
  });

  it("resolves a watch item via PATCH and records the event", async () => {
    const cookie = await signInAndGetCookie(uniqueEmail("watch4"));
    const { obligation } = await analyze("Your Adobe plan renews October 14 at $19.99/month.");
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
        body: JSON.stringify({ status: "resolved", note: "Cancelled with Adobe on the phone." }),
      }),
      { params: Promise.resolve({ id: watchItem.id }) },
    );
    expect(patch.status).toBe(200);
    const patchJson = await patch.json();
    expect(patchJson.watchItem.status).toBe("resolved");
    expect(patchJson.watchItem.userNote).toContain("Cancelled");

    const events = await db.event.findMany({
      where: { obligationId: obligation.id, type: "resolved" },
    });
    expect(events.length).toBe(1);
  });

  it("rejects PATCH on another user's watch item", async () => {
    const cookieA = await signInAndGetCookie(uniqueEmail("owner"));
    const cookieB = await signInAndGetCookie(uniqueEmail("intruder"));
    const { obligation } = await analyze("Your Adobe plan renews October 14 at $19.99/month.");
    const { watchItem } = await (
      await watchPOST(
        new Request("http://localhost/api/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieA },
          body: JSON.stringify({ obligationId: obligation.id }),
        }),
      )
    ).json();

    const patch = await watchPATCH(
      new Request(`http://localhost/api/watch/${watchItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({ status: "dismissed" }),
      }),
      { params: Promise.resolve({ id: watchItem.id }) },
    );
    expect(patch.status).toBe(404);
  });

  it("returns 401 for GET /api/watchlist without a session", async () => {
    const res = await watchlistGET(new Request("http://localhost/api/watchlist"));
    expect(res.status).toBe(401);
  });
});
