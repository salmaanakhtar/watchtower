// Route integration tests — exercise the API handlers against a real SQLite DB.
// Uses the same migration as dev, but a throwaway test database.

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";

const TEST_DB = path.join(__dirname, ".test.db");
process.env.DATABASE_URL = `file:${TEST_DB}`;

import { POST as analysesPOST } from "@/app/api/analyses/route";
import { POST as waitlistPOST } from "@/app/api/waitlist/route";
import { GET as adminGET } from "@/app/api/admin/route";

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
