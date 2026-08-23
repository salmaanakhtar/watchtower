// WT-11: unit + integration tests for inbound email infrastructure.
// Covers: Svix signature verification, address resolution, anti-abuse gates,
// content extraction, dedupe, quarantine, and the end-to-end webhook
// processing path against a real SQLite DB (with a stub Resend API key so
// fetchReceivedEmail is exercised against a local stub).

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_DB = path.join(__dirname, `.inbound.test.${process.pid}.${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;
process.env.RESEND_WEBHOOK_SECRET = "test-webhook-secret";
process.env.RESEND_API_KEY = "re_test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { db } from "@/lib/db";
import {
  verifyWebhookSignature,
  resolveAddress,
  checkRateLimit,
  extractInboundText,
  processInboundWebhook,
  localPartOf,
  normalizeAddress,
  MAX_PER_ADDRESS_PER_DAY,
  INBOUND_ADDR_PREFIX,
  type InboundWebhookEvent,
  type ResendReceivedEmail,
} from "@/lib/inbound";

function signPayload(payload: string, id: string, timestamp: string, secret: string) {
  const sig = createHmac("sha256", secret).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return `v1,${sig}`;
}

function webhookRequest(
  payload: string,
  secret: string = process.env.RESEND_WEBHOOK_SECRET!,
  opts: { id?: string; timestamp?: string; tamper?: boolean } = {},
) {
  const id = opts.id ?? "msg_test123";
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const sig = opts.tamper ? "v1,deadbeef" : signPayload(payload, id, timestamp, secret);
  return {
    raw: payload,
    headers: { id, timestamp, signature: sig },
  };
}

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

let userId: string;
let addressId: string;
let localPart: string;

async function createTestUserAndAddress() {
  const user = await db.user.create({
    data: { email: encrypt("user@example.com"), emailHash: hash("user@example.com"), anonymous: false },
  });
  localPart = `${INBOUND_ADDR_PREFIX}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const address = await db.inboundAddress.create({
    data: { userId: user.id, localPart, domain: "in.watchtower.salmaan.dev", token: localPart.slice(2) },
  });
  userId = user.id;
  addressId = address.id;
}

import { encryptField, hashForLookup } from "@/lib/crypto";
const encrypt = (s: string) => encryptField(s) ?? s;
const hash = (s: string) => hashForLookup(s.toLowerCase());

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
  // fresh user + address per test
  await db.submission.deleteMany();
  await db.document.deleteMany();
  await db.obligation.deleteMany();
  await db.inboundMessage.deleteMany();
  await db.inboundAddress.deleteMany();
  await db.user.deleteMany();
  await createTestUserAndAddress();
  vi.restoreAllMocks();
});

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    const { raw, headers } = webhookRequest('{"type":"email.received"}');
    expect(verifyWebhookSignature(raw, headers, process.env.RESEND_WEBHOOK_SECRET)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const req = webhookRequest('{"type":"email.received"}');
    // A different body with the same (valid) signature must be rejected.
    expect(
      verifyWebhookSignature('{"type":"email.received","x":"y"}', req.headers, process.env.RESEND_WEBHOOK_SECRET),
    ).toBe(false);
  });

  it("rejects missing headers", () => {
    const { raw } = webhookRequest('{"type":"email.received"}');
    expect(verifyWebhookSignature(raw, {}, process.env.RESEND_WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const req = webhookRequest('{"type":"email.received"}', undefined, { timestamp: old });
    expect(verifyWebhookSignature(req.raw, req.headers, process.env.RESEND_WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    const { raw, headers } = webhookRequest('{"type":"email.received"}');
    expect(verifyWebhookSignature(raw, headers, null)).toBe(false);
  });

  it("accepts a signature for any candidate in a comma-separated secret list", () => {
    // Resend issues a distinct secret per webhook; the app is configured with
    // both (comma-separated). A payload signed with the second secret must
    // verify against the combined value.
    const payload = '{"type":"email.received"}';
    const req = webhookRequest(payload, "whsec_second");
    const combined = "whsec_first, whsec_second";
    expect(verifyWebhookSignature(req.raw, req.headers, combined)).toBe(true);
  });

  it("rejects when none of the comma-separated secrets match", () => {
    const req = webhookRequest('{"type":"email.received"}', "whsec_unknown");
    expect(verifyWebhookSignature(req.raw, req.headers, "whsec_first, whsec_second")).toBe(false);
  });
});

describe("address helpers", () => {
  it("normalizes + parses local parts", () => {
    expect(normalizeAddress("  U-abc123@IN.Watchtower.Salmaan.Dev ")).toBe("u-abc123@in.watchtower.salmaan.dev");
    expect(localPartOf("Name <u-abc123@in.watchtower.salmaan.dev>")).toBe("u-abc123");
    expect(localPartOf("not-an-address")).toBeNull();
  });

  it("resolves an active address by local part", async () => {
    const resolved = await resolveAddress([`${localPart}@in.watchtower.salmaan.dev`], []);
    expect(resolved?.userId).toBe(userId);
  });

  it("prefers received_for over to", async () => {
    const other = await db.user.create({
      data: { email: encrypt("other@example.com"), emailHash: hash("other@example.com") },
    });
    const otherLocal = `${INBOUND_ADDR_PREFIX}othertoken`;
    await db.inboundAddress.create({
      data: { userId: other.id, localPart: otherLocal, domain: "in.watchtower.salmaan.dev", token: "othertoken" },
    });
    const resolved = await resolveAddress([`${localPart}@in.watchtower.salmaan.dev`], [`${otherLocal}@in.watchtower.salmaan.dev`]);
    expect(resolved?.userId).toBe(other.id);
  });

  it("ignores disabled addresses", async () => {
    await db.inboundAddress.update({ where: { id: addressId }, data: { active: false, disabledAt: new Date() } });
    const resolved = await resolveAddress([`${localPart}@in.watchtower.salmaan.dev`], []);
    expect(resolved).toBeNull();
  });
});

describe("anti-abuse rate limit", () => {
  it("allows up to the cap", async () => {
    for (let i = 0; i < MAX_PER_ADDRESS_PER_DAY; i++) {
      await db.inboundMessage.create({
        data: { addressId, resendEmailId: `e-${i}`, status: "received", createdAt: new Date(Date.now() - i * 1000) },
      });
    }
    const res = await checkRateLimit(addressId);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("rate_limited");
  });

  it("allows under the cap", async () => {
    await db.inboundMessage.create({ data: { addressId, resendEmailId: "e-1", status: "received" } });
    const res = await checkRateLimit(addressId);
    expect(res.ok).toBe(true);
  });

  it("only counts the trailing 24h", async () => {
    for (let i = 0; i < MAX_PER_ADDRESS_PER_DAY; i++) {
      await db.inboundMessage.create({
        data: {
          addressId,
          resendEmailId: `e-old-${i}`,
          status: "received",
          createdAt: new Date(Date.now() - 2 * 86_400_000),
        },
      });
    }
    const res = await checkRateLimit(addressId);
    expect(res.ok).toBe(true);
  });
});

describe("extractInboundText", () => {
  it("prefers a PDF attachment over the body", async () => {
    const pdf = makeMinimalPdf("Your Adobe plan renews October 14 at $19.99/month");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/attachment")) {
        return new Response(new Uint8Array(pdf), {
          status: 200,
          headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="bill.pdf"' },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const email: ResendReceivedEmail = {
      id: "e1",
      subject: "Your bill",
      text: "ignored body",
      attachments: [
        { id: "att-1", filename: "bill.pdf", content_type: "application/pdf", size: 64 },
      ],
    };
    const extracted = await extractInboundText(email);
    expect(extracted).not.toBeNull();
    expect(extracted!.method).toContain("attachment");
    vi.restoreAllMocks();
  });

  it("falls back to the body text", async () => {
    const email: ResendReceivedEmail = { id: "e2", subject: "Re", text: "Your Adobe plan renews October 14 at $19.99/mo" };
    const extracted = await extractInboundText(email);
    expect(extracted!.text).toContain("Adobe");
    expect(extracted!.method).toBe("text");
  });

  it("returns null for too-large attachment set", async () => {
    const email: ResendReceivedEmail = {
      id: "e3",
      attachments: [{ id: "a", filename: "big.pdf", content_type: "application/pdf", size: 11 * 1024 * 1024 }],
    };
    expect(await extractInboundText(email)).toBeNull();
  });
});

describe("processInboundWebhook", () => {
  it("ingests a forwarded email into the canonical pipeline", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/attachment")) {
        return new Response("not used", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response(
        JSON.stringify({
          id: "email-1",
          from: "acme@example.com",
          subject: "Your Adobe plan renews October 14 at $19.99/mo",
          text: "Your Adobe plan renews October 14 at $19.99/month. Cancel before then.",
          attachments: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const event: InboundWebhookEvent = {
      type: "email.received",
      data: {
        email_id: "email-1",
        from: "acme@example.com",
        to: [`${localPart}@in.watchtower.salmaan.dev`],
        message_id: "<msg-1@example.com>",
        subject: "Your Adobe plan renews October 14 at $19.99/mo",
        attachments: [],
      },
    };
    const result = await processInboundWebhook(event);
    expect(result.status).toBe("ingested");
    expect(result.documentId).toBeTruthy();

    const msg = await db.inboundMessage.findUnique({ where: { resendEmailId: "email-1" } });
    expect(msg?.status).toBe("ingested");
    expect(msg?.userId).toBe(userId);

    const doc = await db.document.findUnique({ where: { id: result.documentId } });
    expect(doc?.source).toBe("forward");

    const obligation = await db.obligation.findFirst({ where: { documentId: doc?.id } });
    expect(obligation?.kind).toBe("subscription");
    vi.restoreAllMocks();
  });

  it("is idempotent: a retried webhook does not re-ingest", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/attachment")) {
        return new Response("not used", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response(
        JSON.stringify({
          id: "email-2",
          from: "acme@example.com",
          subject: "Renewal",
          text: "Your Adobe plan renews October 14 at $19.99/month.",
          attachments: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const event: InboundWebhookEvent = {
      type: "email.received",
      data: {
        email_id: "email-2",
        from: "acme@example.com",
        to: [`${localPart}@in.watchtower.salmaan.dev`],
        subject: "Renewal",
        attachments: [],
      },
    };
    const first = await processInboundWebhook(event);
    const second = await processInboundWebhook(event);
    expect(first.status).toBe("ingested");
    expect(second.messageId).toBe(first.messageId);
    const docs = await db.document.count({ where: { source: "forward" } });
    expect(docs).toBe(1);
    vi.restoreAllMocks();
  });

  it("quarantines mail to an unknown address", async () => {
    const event: InboundWebhookEvent = {
      type: "email.received",
      data: { email_id: "email-3", from: "spam@example.com", to: ["u-nonexistent@in.watchtower.salmaan.dev"] },
    };
    const result = await processInboundWebhook(event);
    expect(result.status).toBe("quarantined");
    expect(result.reason).toBe("unknown_address");
    const msg = await db.inboundMessage.findUnique({ where: { resendEmailId: "email-3" } });
    expect(msg?.quarantineReason).toBe("unknown_address");
  });

  it("quarantines unsubscribe emails without ingesting", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/attachment")) {
        return new Response("not used", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response(
        JSON.stringify({
          id: "email-4",
          subject: "Unsubscribe",
          text: "Unsubscribe me from this list.",
          attachments: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const event: InboundWebhookEvent = {
      type: "email.received",
      data: {
        email_id: "email-4",
        from: "newsletter@example.com",
        to: [`${localPart}@in.watchtower.salmaan.dev`],
        subject: "Unsubscribe",
      },
    };
    const result = await processInboundWebhook(event);
    expect(result.status).toBe("quarantined");
    expect(result.reason).toBe("unsubscribe");
    const msg = await db.inboundMessage.findUnique({ where: { resendEmailId: "email-4" } });
    expect(msg?.quarantineReason).toBe("unsubscribe");
    const docs = await db.document.count({ where: { source: "forward" } });
    expect(docs).toBe(0);
    vi.restoreAllMocks();
  });

  it("dedupes identical content", async () => {
    const body = "Your Adobe plan renews October 14 at $19.99/month. Cancel before then.";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/attachment")) {
        return new Response("not used", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response(
        JSON.stringify({ id: "email-5", subject: "Bill", text: body, attachments: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const makeEvent = (emailId: string): InboundWebhookEvent => ({
      type: "email.received",
      data: {
        email_id: emailId,
        from: "acme@example.com",
        to: [`${localPart}@in.watchtower.salmaan.dev`],
        subject: "Bill",
      },
    });
    await processInboundWebhook(makeEvent("email-5a"));
    const second = await processInboundWebhook(makeEvent("email-5b"));
    expect(second.status).toBe("ingested");
    expect(second.reason).toBe("dedupe");
    const docs = await db.document.count({ where: { source: "forward" } });
    expect(docs).toBe(1);
    vi.restoreAllMocks();
  });

  it("quarantines when fetch fails (no RESEND_API_KEY)", async () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const event: InboundWebhookEvent = {
        type: "email.received",
        data: { email_id: "email-6", from: "acme@example.com", to: [`${localPart}@in.watchtower.salmaan.dev`] },
      };
      const result = await processInboundWebhook(event);
      expect(result.status).toBe("quarantined");
      expect(result.reason).toBe("fetch_failed");
    } finally {
      process.env.RESEND_API_KEY = saved;
    }
  });
});
