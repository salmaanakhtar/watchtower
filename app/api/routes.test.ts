// Route integration tests — exercise the API handlers against a real SQLite DB.
// Uses the same migration as dev, but a throwaway test database.

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";

const TEST_DB = path.join(__dirname, ".test.db");
process.env.DATABASE_URL = `file:${TEST_DB}`;

import { POST as analysesPOST } from "@/app/api/analyses/route";
import { GET as analysisGET } from "@/app/api/analyses/[id]/route";
import { POST as waitlistPOST } from "@/app/api/waitlist/route";
import { GET as adminGET } from "@/app/api/admin/route";
import { PATCH as adminPATCH } from "@/app/api/admin/[id]/route";

beforeAll(() => {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    cwd: path.join(__dirname, "..", ".."),
    stdio: "pipe",
  });
});

afterAll(() => {
  try {
    unlinkSync(TEST_DB);
  } catch {}
});

describe("POST /api/analyses", () => {
  it("returns an analysis for pasted text", async () => {
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Your Adobe plan renews on October 14 at $19.99/month. Cancel before.",
          variant: "A",
          kind: "paste",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBeTruthy();
    expect(json.result.kind).toBe("subscription");
    expect(json.result.exposureCentsPerYear).toBe(Math.round(19.99 * 12 * 100));
  });

  it("rejects invalid JSON", async () => {
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects empty content", async () => {
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("analyzes a decoded text file upload and stores the result", async () => {
    const b64 = Buffer.from(
      "Your home insurance policy renews on November 1 at $850 per year. Cancel before then.",
    ).toString("base64");
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "policy.txt",
          variant: "A",
          kind: "file",
          contentType: "text/plain",
          filename: "policy.txt",
          base64: b64,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(false);
    expect(json.result.kind).toBe("subscription");
    expect(json.result.exposureCentsPerYear).toBe(85000);
  });

  it("queues PDF uploads for manual review (no fake result)", async () => {
    const b64 = Buffer.from("%PDF-1.4\n1 0 obj\n<<fake>>").toString("base64");
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "bill.pdf",
          variant: "A",
          kind: "file",
          contentType: "application/pdf",
          filename: "bill.pdf",
          base64: b64,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(true);
    expect(json.result).toBeNull();
  });

  it("retains raw bytes for queued uploads so the admin can review the actual file", async () => {
    const b64 = Buffer.from("%PDF-1.4\n1 0 obj\n<<fake>>").toString("base64");
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "bill.pdf",
          variant: "A",
          kind: "file",
          contentType: "application/pdf",
          filename: "bill.pdf",
          base64: b64,
        }),
      }),
    );
    const { id } = await res.json();
    process.env.ADMIN_SECRET = "test-secret";
    const adminRes = await adminGET(
      new Request("http://localhost/api/admin", {
        headers: { Authorization: "Bearer test-secret" },
      }),
    );
    const json = await adminRes.json();
    const submission = json.submissions.find((s: { id: string }) => s.id === id);
    expect(submission).toBeTruthy();
    expect(submission.rawBytes).toBe(b64);
    expect(submission.dataUrl).toContain("data:application/pdf;base64,");
    expect(submission.status).toBe("queued");
  });

  it("rejects unsupported file types", async () => {
    const b64 = Buffer.from("PK\x03\x04fakezip").toString("base64");
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "x.zip",
          variant: "A",
          kind: "file",
          contentType: "application/zip",
          filename: "x.zip",
          base64: b64,
        }),
      }),
    );
    expect(res.status).toBe(415);
  });

  it("rejects kind=file without base64", async () => {
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "x", variant: "A", kind: "file" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/analyses/[id]", () => {
  it("returns the stored result idempotently", async () => {
    const post = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Your Adobe plan renews on October 14 at $19.99/month. Cancel before.",
          variant: "A",
          kind: "paste",
        }),
      }),
    );
    const { id } = await post.json();

    const res = await analysisGET(new Request("http://localhost/api/analyses/x"), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(id);
    expect(json.result.kind).toBe("subscription");
    expect(json.queued).toBe(false);
  });

  it("returns 404 for unknown ids", async () => {
    const res = await analysisGET(new Request("http://localhost/api/analyses/x"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/waitlist", () => {
  it("adds an email", async () => {
    const res = await waitlistPOST(
      new Request("http://localhost/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com" }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("rejects invalid email", async () => {
    const res = await waitlistPOST(
      new Request("http://localhost/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin", () => {
  it("requires auth", async () => {
    const res = await adminGET(new Request("http://localhost/api/admin"));
    expect(res.status).toBe(401);
  });

  it("returns submissions + waitlist with auth", async () => {
    process.env.ADMIN_SECRET = "test-secret";
    const res = await adminGET(
      new Request("http://localhost/api/admin", {
        headers: { Authorization: "Bearer test-secret" },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.submissions.length).toBeGreaterThan(0);
    expect(json.waitlist.length).toBeGreaterThan(0);
  });
});

describe("PATCH /api/admin/[id]", () => {
  it("requires auth", async () => {
    const res = await adminPATCH(
      new Request("http://localhost/api/admin/x", { method: "PATCH" }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(401);
  });

  it("marks a queued submission reviewed with category + analysis", async () => {
    const b64 = Buffer.from("%PDF-1.4\n1 0 obj\n<<fake>>").toString("base64");
    const post = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "bill.pdf",
          variant: "A",
          kind: "file",
          contentType: "application/pdf",
          filename: "bill.pdf",
          base64: b64,
        }),
      }),
    );
    const { id } = await post.json();
    process.env.ADMIN_SECRET = "test-secret";
    const res = await adminPATCH(
      new Request("http://localhost/api/admin/x", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: "bill",
          analysis: "Monthly electricity bill; no auto-renewal risk.",
          status: "reviewed",
        }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated.category).toBe("bill");
    expect(json.updated.analysis).toContain("electricity");
    expect(json.updated.status).toBe("reviewed");
  });
});
