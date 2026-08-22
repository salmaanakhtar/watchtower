import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  llmConfig,
  llmExtractionEnabled,
  structuredExtract,
  STRUCTURED_EXTRACTION_SCHEMA,
  StructuredExtraction,
} from "@/lib/llm-extract";
import { toCanonicalStructured } from "@/lib/obligations";

const ORIG_ENV = { ...process.env };

function validPayload(overrides: Record<string, unknown> = {}): StructuredExtraction {
  return {
    documentKind: "subscription",
    counterparty: { name: "Adobe", confidence: 0.95 },
    amount: { cents: 1999, currency: "USD", interval: "monthly", confidence: 0.97 },
    dates: {
      startDate: null,
      renewalDate: "2026-10-14",
      noticeDeadlineDate: "2026-10-07",
      expiryDate: null,
      dueDate: "2026-10-14",
    },
    cancellationTerms: { autoRenews: true, noticePeriodDays: 7, quote: "renews automatically" },
    risk: {
      type: "auto_renewal",
      verification: "certain",
      confidence: 0.92,
      exposureLowCents: 23988,
      exposureHighCents: 23988,
      exposureAssumption: "$19.99/mo × 12 = $240 if not cancelled",
    },
    facts: [
      { label: "amount", value: "$19.99/month", quote: "renews at $19.99 per month", offsetStart: 12, offsetEnd: 28, confidence: 0.97 },
      { label: "renewal date", value: "2026-10-14", quote: "renews on October 14", offsetStart: 30, offsetEnd: 47, confidence: 0.9 },
    ],
    explanation: "Auto-renewing subscription.",
    ...overrides,
  };
}

function mockChatCompletion(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })));
}

beforeEach(() => {
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://api.test/v1";
  process.env.LLM_MODEL = "gpt-4o-mini";
  process.env.LLM_TIMEOUT_MS = "5000";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIG_ENV };
});

describe("llmConfig / llmExtractionEnabled", () => {
  it("returns null (disabled) without an API key", () => {
    delete process.env.LLM_API_KEY;
    expect(llmConfig()).toBeNull();
    expect(llmExtractionEnabled()).toBe(false);
  });
  it("reads config when a key is set", () => {
    const cfg = llmConfig();
    expect(cfg!.apiKey).toBe("test-key");
    expect(cfg!.baseUrl).toBe("https://api.test/v1");
    expect(cfg!.model).toBe("gpt-4o-mini");
  });
});

describe("STRUCTURED_EXTRACTION_SCHEMA", () => {
  it("accepts a fully-populated extraction", () => {
    expect(STRUCTURED_EXTRACTION_SCHEMA.safeParse(validPayload()).success).toBe(true);
  });
  it("rejects a bad risk type", () => {
    const r = STRUCTURED_EXTRACTION_SCHEMA.safeParse(validPayload({ risk: { ...validPayload().risk, type: "bogus" } }));
    expect(r.success).toBe(false);
  });
  it("rejects negative cents", () => {
    const r = STRUCTURED_EXTRACTION_SCHEMA.safeParse(
      validPayload({ amount: { ...validPayload().amount, cents: -5 } }),
    );
    expect(r.success).toBe(false);
  });
  it("rejects a non-ISO date", () => {
    const r = STRUCTURED_EXTRACTION_SCHEMA.safeParse(
      validPayload({ dates: { ...validPayload().dates, renewalDate: "October 14" } }),
    );
    expect(r.success).toBe(false);
  });
});

describe("structuredExtract", () => {
  it("returns schema-validated output from the provider", async () => {
    mockChatCompletion({ choices: [{ message: { content: JSON.stringify(validPayload()) } }] });
    const out = await structuredExtract("Your Adobe plan renews on October 14 at $19.99/month.");
    expect(out).not.toBeNull();
    expect(out!.counterparty?.name).toBe("Adobe");
    expect(out!.dates.renewalDate).toBe("2026-10-14");
    expect(out!.risk.type).toBe("auto_renewal");
  });

  it("tolerates prose wrapped around the JSON object", async () => {
    mockChatCompletion({ choices: [{ message: { content: `Here you go:\n${JSON.stringify(validPayload())}\n— end` } }] });
    const out = await structuredExtract("some text");
    expect(out).not.toBeNull();
  });

  it("retries once when the first response fails schema validation", async () => {
    const calls = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls();
      return calls.mock.calls.length === 1
        ? { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ nope: true }) } }] }) }
        : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(validPayload()) } }] }) };
    }));
    const out = await structuredExtract("text");
    expect(out).not.toBeNull();
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("returns null when the provider returns an error", async () => {
    mockChatCompletion({ error: { message: "invalid key" } }, 401);
    expect(await structuredExtract("text")).toBeNull();
  });

  it("returns null when the response is not JSON", async () => {
    mockChatCompletion({ choices: [{ message: { content: "not json at all" } }] });
    expect(await structuredExtract("text")).toBeNull();
  });

  it("returns null when disabled (no key)", async () => {
    delete process.env.LLM_API_KEY;
    expect(await structuredExtract("text")).toBeNull();
  });
});

describe("toCanonicalStructured", () => {
  it("maps ISO dates + per-field confidence into canonical rows", () => {
    const { obligation, facts } = toCanonicalStructured(validPayload(), {
      source: "upload",
      filename: "bill.pdf",
      contentType: "application/pdf",
      extractedText: "Your Adobe plan renews on October 14 at $19.99/month.",
      extractionMethod: "llm",
    });
    expect(obligation.kind).toBe("subscription");
    expect(obligation.counterpartyName).toBe("Adobe");
    expect(obligation.amountCents).toBe(1999);
    expect(obligation.interval).toBe("monthly");
    expect(obligation.renewalDate).toBe("2026-10-14");
    expect(obligation.noticeDeadlineDate).toBe("2026-10-07");
    expect(obligation.dueDate).toBe("2026-10-14");
    expect(obligation.autoRenews).toBe(true);
    expect(obligation.verification).toBe("certain");
    expect(obligation.confidence).toBe(0.92);
    expect(obligation.riskType).toBe("auto_renewal");
    expect(facts.length).toBe(2);
    expect(facts[0].confidence).toBe(0.97);
    expect(facts[0].offsetStart).toBe(12);
  });

  it("synthesizes provenance when the model returns no facts", () => {
    const { facts } = toCanonicalStructured(validPayload({ facts: [] }), {
      source: "paste",
      filename: null,
      contentType: "text/plain",
      extractedText: "Your Adobe plan renews on October 14 at $19.99/month.",
    });
    expect(facts.length).toBeGreaterThanOrEqual(2);
    expect(facts.some((f) => f.label === "counterparty")).toBe(true);
    expect(facts.some((f) => f.label === "amount")).toBe(true);
  });
});