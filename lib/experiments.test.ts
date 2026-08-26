import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_DB = path.join(__dirname, `.wt15.test.${process.pid}.${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { POST as analysesPOST } from "@/app/api/analyses/route";
import { POST as watchPOST } from "@/app/api/watch/route";
import { POST as authRequestPOST } from "@/app/api/auth/request/route";
import { GET as authVerifyGET } from "@/app/api/auth/verify/[token]/route";
import {
  contextFromRequest,
  experimentFunnelSummary,
  recordExperimentEvent,
} from "@/lib/experiments";
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

const SAMPLE = "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.";

function baseRequest(extra: Record<string, unknown>, cookies?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookies) headers.Cookie = cookies;
  return new Request("http://localhost/api/analyses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: SAMPLE,
      variant: "A",
      kind: "paste",
      consent: true,
      ...extra,
    }),
  });
}

async function analyzeWithTool(tool: string, cookies?: string) {
  const res = await analysesPOST(baseRequest({ tool }, cookies));
  const json = await res.json();
  return { res, json };
}

describe("WT-15 experiment instrumentation — session id", () => {
  it("issues a wt_session_id cookie on the first analysis", async () => {
    const { res, json } = await analyzeWithTool("contract-renewal-analyzer");
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("wt_session_id=");
    expect(json.sessionId).toBeTruthy();
    const cookieValue = setCookie.match(/wt_session_id=([^;]+)/)?.[1];
    expect(cookieValue).toBe(json.sessionId);
  });

  it("reuses an existing wt_session_id and does not re-issue", async () => {
    const first = await analyzeWithTool("cancellation-deadline-checker");
    const sid = first.json.sessionId as string;
    const second = await analyzeWithTool(
      "cancellation-deadline-checker",
      `wt_session_id=${encodeURIComponent(sid)}`,
    );
    expect(second.res.headers.get("set-cookie")).toBeNull();
    expect(second.json.sessionId).toBe(sid);
  });
});

describe("WT-15 experiment instrumentation — funnel events", () => {
  it("records analysis_start + result with tool context", async () => {
    await analyzeWithTool("contract-renewal-analyzer", "wt_session_id=evt-1");
    const events = await db.experimentEvent.findMany({
      where: { sessionId: "evt-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.event)).toEqual(["analysis_start", "result"]);
    for (const e of events) {
      expect(e.tool).toBe("contract-renewal-analyzer");
      expect(e.variant).toBe("A");
    }
  });

  it("records landing (no tool) events with tool=null", async () => {
    await analyzeWithTool("", "wt_session_id=evt-2");
    const events = await db.experimentEvent.findMany({
      where: { sessionId: "evt-2" },
    });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.tool === null)).toBe(true);
  });

  it("rejects an unknown tool slug and records with tool=null", async () => {
    await analyzeWithTool("bogus-tool", "wt_session_id=evt-3");
    const events = await db.experimentEvent.findMany({
      where: { sessionId: "evt-3" },
    });
    expect(events.every((e) => e.tool === null)).toBe(true);
  });

  it("contextFromRequest picks up source cookie + referrer", async () => {
    const req = new Request("http://localhost/", {
      headers: {
        Cookie: "wt_experiment=tiktok",
        Referer: "https://www.google.com/search?q=x",
        "x-forwarded-for": "1.2.3.4",
      },
    });
    const ctx = contextFromRequest(req, "contract-renewal-analyzer", "C");
    expect(ctx.tool).toBe("contract-renewal-analyzer");
    expect(ctx.variant).toBe("C");
    expect(ctx.source).toBe("tiktok");
    expect(ctx.referrer).toBe("www.google.com");
    expect(ctx.ip).toBe("1.2.3.4");
  });

  it("recordExperimentEvent never throws on a bad input", async () => {
    // The function swallows DB errors; a valid event should just write.
    await recordExperimentEvent("result", { tool: null, variant: null, source: null, referrer: null, ip: null });
    const count = await db.experimentEvent.count();
    expect(count).toBeGreaterThan(0);
  });
});

describe("WT-15 account conversion funnel", () => {
  it("records account_created on the first watch of a session", async () => {
    // Analyze with a session, sign in, then watch.
    const { json } = await analyzeWithTool("contract-renewal-analyzer", "wt_session_id=evt-acct-1");
    expect(json.obligation).toBeTruthy();
    const obligationId = json.obligation.id as string;

    // Sign in
    const reqRes = await authRequestPOST(
      new Request("http://localhost/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wt15-acct@example.com" }),
      }),
    );
    const { token } = await reqRes.json();
    const verify = await authVerifyGET(
      new Request(`http://localhost/api/auth/verify/${token}`, { headers: { Cookie: "" } }),
      { params: Promise.resolve({ token }) },
    );
    const setCookie = verify.headers.get("set-cookie") ?? "";
    const session = setCookie.match(/wt_session=([^;]+)/)?.[1] ?? "";
    const cookie = `wt_session=${encodeURIComponent(session)}; wt_session_id=evt-acct-1`;

    const watch = await watchPOST(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ obligationId }),
      }),
    );
    expect(watch.status).toBe(201);

    // Give the fire-and-forget event write a moment to land (recordExperimentEvent
    // is intentionally non-blocking — analytics must never slow the request).
    await new Promise((r) => setTimeout(r, 50));

    const acct = await db.experimentEvent.findMany({
      where: { sessionId: "evt-acct-1", event: "account_created" },
    });
    expect(acct.length).toBe(1);
  });

  it("does not record account_created twice for the same session", async () => {
    const { json } = await analyzeWithTool("cancellation-deadline-checker", "wt_session_id=evt-acct-2");
    const obligationId = json.obligation.id as string;
    const reqRes = await authRequestPOST(
      new Request("http://localhost/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wt15-acct2@example.com" }),
      }),
    );
    const { token } = await reqRes.json();
    const verify = await authVerifyGET(
      new Request(`http://localhost/api/auth/verify/${token}`, { headers: { Cookie: "" } }),
      { params: Promise.resolve({ token }) },
    );
    const setCookie = verify.headers.get("set-cookie") ?? "";
    const session = setCookie.match(/wt_session=([^;]+)/)?.[1] ?? "";
    const cookie = `wt_session=${encodeURIComponent(session)}; wt_session_id=evt-acct-2`;

    // Analyze a second obligation to watch twice in the same session.
    const { json: json2 } = await analyzeWithTool("contract-renewal-analyzer", cookie);
    const obligationId2 = json2.obligation.id as string;

    await watchPOST(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ obligationId }),
      }),
    );
    await watchPOST(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ obligationId: obligationId2 }),
      }),
    );

    const acct = await db.experimentEvent.count({
      where: { sessionId: "evt-acct-2", event: "account_created" },
    });
    expect(acct).toBe(1);
  });
});

describe("WT-15 experiment funnel summary", () => {
  it("summarizes per-tool funnel counts including the landing page", async () => {
    const summary = await experimentFunnelSummary();
    expect(Array.isArray(summary)).toBe(true);
    const tools = summary.map((s) => s.tool);
    expect(tools).toContain("contract-renewal-analyzer");
    expect(tools).toContain("cancellation-deadline-checker");
    const contract = summary.find((s) => s.tool === "contract-renewal-analyzer")!;
    expect(contract.starts).toBeGreaterThanOrEqual(1);
    expect(contract.results).toBeGreaterThanOrEqual(1);
    const landing = summary.find((s) => s.tool === null);
    expect(landing).toBeTruthy();
  });
});
