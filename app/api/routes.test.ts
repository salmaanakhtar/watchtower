// Route integration tests â€” exercise the API handlers against a real SQLite DB.
// Uses the same migration as dev, but a throwaway test database.

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";

const TEST_DB = path.join(__dirname, ".test.db");
process.env.DATABASE_URL = `file:${TEST_DB}`;

function makeMinimalPdf(text: string): Buffer {
  const objs = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${100} >> stream\nBT /F1 18 Tf 72 720 Td (${text}) Tj ET\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(content));
    content += o + "\n";
  }
  const xrefStart = Buffer.byteLength(content);
  content += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    content += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  content += "trailer << /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF";
  return Buffer.from(content, "utf8");
}

import { POST as analysesPOST } from "@/app/api/analyses/route";
import { GET as analysisGET } from "@/app/api/analyses/[id]/route";
import { POST as waitlistPOST } from "@/app/api/waitlist/route";
import { GET as adminGET } from "@/app/api/admin/route";
import { PATCH as adminPATCH } from "@/app/api/admin/[id]/route";
import { db } from "@/lib/db";

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
          consent: true,
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

  it("persists the canonical obligation + provenance facts (WT-4)", async () => {
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
    const json = await res.json();
    expect(json.obligation?.id).toBeTruthy();

    const doc = await db.document.findFirst({
      where: { submissionId: json.id },
      select: {
        id: true,
        source: true,
        contentHash: true,
        obligations: {
          select: {
            id: true,
            kind: true,
            counterpartyName: true,
            amountCents: true,
            currency: true,
            interval: true,
            riskType: true,
            verification: true,
            confidence: true,
            status: true,
            facts: { select: { label: true, quote: true, offsetStart: true, offsetEnd: true } },
          },
        },
      },
    });
    expect(doc).toBeTruthy();
    expect(doc!.source).toBe("paste");
    expect(doc!.contentHash).toBeTruthy();
    expect(doc!.obligations).toHaveLength(1);
    const ob = doc!.obligations[0];
    expect(ob.kind).toBe("subscription");
    expect(ob.counterpartyName).toContain("Adobe");
    expect(ob.amountCents).toBe(Math.round(19.99 * 12 * 100));
    expect(ob.currency).toBe("USD");
    expect(ob.interval).toBe("yearly");
    expect(ob.riskType).toBe("auto_renewal");
    expect(ob.verification).toBe("certain");
    expect(ob.confidence).toBeGreaterThanOrEqual(0.9);
    expect(ob.status).toBe("open");
    const labels = ob.facts.map((f) => f.label);
    expect(labels).toContain("amount");
    expect(labels).toContain("deadline");
    expect(labels).toContain("counterparty");
    const amount = ob.facts.find((f) => f.label === "amount");
    expect(amount!.quote).toContain("$19.99/month");
    expect(amount!.offsetStart).toBeTypeOf("number");
    expect(amount!.offsetEnd).toBeTypeOf("number");
  });

  it("returns the canonical obligation from GET /api/analyses/[id] (WT-4)", async () => {
    const post = await analysesPOST(
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
    const { id } = await post.json();
    const res = await analysisGET(new Request("http://localhost/api/analyses/x"), {
      params: Promise.resolve({ id }),
    });
    const json = await res.json();
    expect(json.obligation?.id).toBeTruthy();
    expect(json.obligation?.kind).toBe("subscription");
    expect(json.obligation?.facts.length).toBeGreaterThan(0);
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
          consent: true,
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
          consent: true,
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

  it("extracts a real PDF's text layer and analyzes it instead of queuing (WT-3)", async () => {
    const pdf = makeMinimalPdf("Your Adobe plan renews on October 14 at $19.99 per month.");
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "bill.pdf",
          variant: "A",
          kind: "file",
          consent: true,
          contentType: "application/pdf",
          filename: "bill.pdf",
          base64: pdf.toString("base64"),
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(false);
    expect(json.result.kind).toBe("subscription");
    expect(json.result.exposureCentsPerYear).toBe(Math.round(19.99 * 12 * 100));
    expect(json.obligation?.id).toBeTruthy();

    const doc = await db.document.findFirst({
      where: { submissionId: json.id },
      select: { extractionMethod: true },
    });
    expect(doc?.extractionMethod).toBe("pdf-parse");
  });

  it("parses .eml uploads and analyzes the email body (WT-3)", async () => {
    const eml = [
      "From: billing@example.com",
      "Subject: Your plan renews",
      "Content-Type: text/plain",
      "",
      "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.",
      "",
    ].join("\n");
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "renewal.eml",
          variant: "A",
          kind: "file",
          consent: true,
          contentType: "message/rfc822",
          filename: "renewal.eml",
          base64: Buffer.from(eml).toString("base64"),
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(false);
    expect(json.result.kind).toBe("subscription");

    const doc = await db.document.findFirst({
      where: { submissionId: json.id },
      select: { extractionMethod: true },
    });
    expect(doc?.extractionMethod).toBe("eml");
  });

  it("stores an ISO dueDate on the canonical obligation (WT-3)", async () => {
    const res = await analysesPOST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Your Adobe plan renews on October 14 at $19.99/month. Cancel before.",
          variant: "A",
          kind: "paste",
          consent: true,
        }),
      }),
    );
    const json = await res.json();
    const ob = await db.obligation.findFirst({ where: { id: json.obligation.id } });
    expect(ob?.dueDate).toBeInstanceOf(Date);
    expect(ob?.renewalDate).toBeInstanceOf(Date);
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
          consent: true,
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
          consent: true,
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
          consent: true,
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
          consent: true,
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

// ─── WT-11: inbound webhook + reputation event routes ──────────────────────

import { createHmac } from "node:crypto";
import { POST as inboundPOST } from "@/app/api/inbound/webhook/route";
import { POST as eventsPOST } from "@/app/api/inbound/events/route";

const WH_SECRET = "route-test-webhook-secret";
process.env.RESEND_WEBHOOK_SECRET = WH_SECRET;

function signedHeaders(payload: string, id = "msg_route1") {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", WH_SECRET).update(`${id}.${ts}.${payload}`).digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": ts,
    "svix-signature": `v1,${sig}`,
    "Content-Type": "application/json",
  };
}

describe("POST /api/inbound/webhook", () => {
  it("rejects an unsigned request", async () => {
    const res = await inboundPOST(
      new Request("http://localhost/api/inbound/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"type":"email.received","data":{}}',
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a tampered signature", async () => {
    const payload = '{"type":"email.received","data":{}}';
    const res = await inboundPOST(
      new Request("http://localhost/api/inbound/webhook", {
        method: "POST",
        headers: { "svix-id": "msg_1", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,bad" },
        body: payload,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ignores non-email.received events", async () => {
    const payload = '{"type":"email.sent","data":{}}';
    const res = await inboundPOST(
      new Request("http://localhost/api/inbound/webhook", {
        method: "POST",
        headers: signedHeaders(payload),
        body: payload,
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe("email.sent");
  });

  it("quarantines an unknown-address email (no RESEND_API_KEY)", async () => {
    const payload = JSON.stringify({
      type: "email.received",
      data: {
        email_id: "email-route-1",
        from: "spam@example.com",
        to: ["u-nope@in.watchtower.salmaan.dev"],
      },
    });
    const res = await inboundPOST(
      new Request("http://localhost/api/inbound/webhook", {
        method: "POST",
        headers: signedHeaders(payload, "msg_route_unknown"),
        body: payload,
      }),
    );
    expect(res.status).toBe(200);
    const msg = await db.inboundMessage.findUnique({ where: { resendEmailId: "email-route-1" } });
    expect(msg?.status).toBe("quarantined");
    expect(msg?.quarantineReason).toBe("unknown_address");
  });
});

describe("POST /api/inbound/events (reputation)", () => {
  it("rejects an unsigned request", async () => {
    const res = await eventsPOST(
      new Request("http://localhost/api/inbound/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"type":"email.bounced","data":{}}',
      }),
    );
    expect(res.status).toBe(400);
  });

  it("records a bounce event", async () => {
    const before = await db.reputationEvent.count();
    const payload = JSON.stringify({
      type: "email.bounced",
      data: { email: "user@example.com", bounce: { bounce_type: "hard_bounce" } },
    });
    const res = await eventsPOST(
      new Request("http://localhost/api/inbound/events", {
        method: "POST",
        headers: signedHeaders(payload, "msg_bounce1"),
        body: payload,
      }),
    );
    expect(res.status).toBe(200);
    const events = await db.reputationEvent.findMany({ orderBy: { createdAt: "desc" } });
    expect(events.length).toBe(before + 1);
    expect(events[0]?.kind).toBe("bounce");
  });

  it("acknowledges unknown event types without recording", async () => {
    const before = await db.reputationEvent.count();
    const payload = JSON.stringify({ type: "email.opened", data: {} });
    const res = await eventsPOST(
      new Request("http://localhost/api/inbound/events", {
        method: "POST",
        headers: signedHeaders(payload, "msg_open1"),
        body: payload,
      }),
    );
    expect(res.status).toBe(200);
    const after = await db.reputationEvent.count();
    expect(after).toBe(before);
  });
});


