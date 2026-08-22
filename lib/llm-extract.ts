// WT-3: LLM structured extraction (the "LLM as extractor, not agent" layer).
//
// This module is env-gated and strictly optional. When configured it turns
// extracted plain text into the canonical obligation schema with per-field
// confidence + provenance quotes. It is a *complement* to the deterministic
// engine (PHASE0_1_PLAN §5.5): temperature ~0, schema-validated with zod,
// retried once on validation failure, and it never throws — on any failure it
// returns null and the pipeline degrades to the deterministic path. The
// deterministic risk logic gates what reaches the user; the LLM only enriches
// the durable structured state (ISO dates, per-field confidence, better
// counterparty/amount extraction).
//
// Provider: OpenAI-compatible chat completions (OpenAI, DeepSeek, Groq, Ollama,
// etc.) via LLM_BASE_URL + LLM_API_KEY + LLM_MODEL. No SDK dependency — a
// single fetch call keeps the bundle small and provider-agnostic.

import { z } from "zod";
import type { CanonicalRiskKind } from "@/lib/obligations";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/** Read the LLM config from env; returns null when LLM extraction is disabled. */
export function llmConfig(): LLMConfig | null {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
  };
}

// ─── Output schema (canonical, mirrors PHASE0_1_PLAN §5.3) ───────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const factSchema = z.object({
  label: z.string().min(1).max(60),
  value: z.string().min(1),
  quote: z.string(),
  offsetStart: z.number().int().nonnegative().nullable(),
  offsetEnd: z.number().int().nonnegative().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const STRUCTURED_EXTRACTION_SCHEMA = z.object({
  documentKind: z.enum([
    "subscription",
    "bill",
    "contract",
    "receipt",
    "refund",
    "notice",
    "other",
  ]),
  counterparty: z
    .object({ name: z.string().min(1).max(200).nullable(), confidence: z.number().min(0).max(1) })
    .nullable(),
  amount: z
    .object({
      cents: z.number().int().nonnegative().nullable(),
      currency: z.string().min(3).max(3).default("USD"),
      interval: z.enum(["monthly", "yearly", "one_time", "quarterly"]).nullable(),
      confidence: z.number().min(0).max(1),
    })
    .nullable(),
  dates: z.object({
    startDate: isoDate,
    renewalDate: isoDate,
    noticeDeadlineDate: isoDate,
    expiryDate: isoDate,
    dueDate: isoDate,
  }),
  cancellationTerms: z.object({
    autoRenews: z.boolean().nullable(),
    noticePeriodDays: z.number().int().nonnegative().nullable(),
    quote: z.string().max(500).nullable(),
  }),
  risk: z.object({
    type: z.enum([
      "price_increase",
      "auto_renewal",
      "forgotten_trial",
      "refund_due",
      "deadline",
      "incorrect_charge",
      "none",
    ]),
    verification: z.enum(["certain", "conditional", "hypothetical"]),
    confidence: z.number().min(0).max(1),
    exposureLowCents: z.number().int().nonnegative().nullable(),
    exposureHighCents: z.number().int().nonnegative().nullable(),
    exposureAssumption: z.string().max(300).nullable(),
  }),
  facts: z.array(factSchema).max(30),
  explanation: z.string().max(1000).nullable(),
});

export type StructuredExtraction = z.infer<typeof STRUCTURED_EXTRACTION_SCHEMA>;

export const STRUCTURED_PROMPT_VERSION = "wt3-structured-v1";

const SYSTEM_PROMPT = `You are a precise document extractor for Watchtower, a service that finds
money leaks and deadlines in bills, contracts, renewal notices, and receipts.

Extract the structured facts from the document. Rules:
- Only extract facts that are actually stated. Never invent amounts, dates, or names.
- Use the verbatim source quote for every fact; include character offsets (start/end) into the document text when you can, else null.
- Money is in integer cents. Currency is a 3-letter code.
- Dates are ISO (YYYY-MM-DD). Use the exact date if stated; otherwise null — never guess a year.
- "verification": certain = the dates/prices are explicitly stated; conditional = the obligation depends on a clause (e.g. "may renew"); hypothetical = you are inferring.
- "risk.type": none when there is no money/deadline risk at all.
- "autoRenews": true only when the document says it renews automatically; false when it explicitly says no auto-renewal; null when unknown.
- Output STRICT JSON matching this schema (no markdown, no commentary):
{
  "documentKind": "subscription|bill|contract|receipt|refund|notice|other",
  "counterparty": { "name": string|null, "confidence": number },
  "amount": { "cents": number|null, "currency": "USD", "interval": "monthly|yearly|one_time|quarterly|null", "confidence": number } | null,
  "dates": { "startDate": "YYYY-MM-DD"|null, "renewalDate": "YYYY-MM-DD"|null, "noticeDeadlineDate": "YYYY-MM-DD"|null, "expiryDate": "YYYY-MM-DD"|null, "dueDate": "YYYY-MM-DD"|null },
  "cancellationTerms": { "autoRenews": boolean|null, "noticePeriodDays": number|null, "quote": string|null },
  "risk": { "type": "price_increase|auto_renewal|forgotten_trial|refund_due|deadline|incorrect_charge|none", "verification": "certain|conditional|hypothetical", "confidence": number, "exposureLowCents": number|null, "exposureHighCents": number|null, "exposureAssumption": string|null },
  "facts": [{ "label": string, "value": string, "quote": string, "offsetStart": number|null, "offsetEnd": number|null, "confidence": number|null }],
  "explanation": string|null
}`;

/** True when LLM extraction is enabled and ready to call. */
export function llmExtractionEnabled(): boolean {
  return llmConfig() !== null;
}

interface LLMCallLog {
  promptVersion: string;
  model: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  attempts: number;
  validationFailed: boolean;
  tokens?: { input?: number; output?: number };
}

/** Structured, minimal LLM call log (PHASE0_1_PLAN §5.6). No document content. */
function logCall(entry: LLMCallLog): void {
  console.log(`[wt3:llm] ${JSON.stringify(entry)}`);
}

async function chatCompletion(
  config: LLMConfig,
  messages: { role: string; content: string }[],
): Promise<{ content: string; status: number; tokens?: { input?: number; output?: number } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      console.error(`[wt3:llm] provider error ${res.status}: ${body?.error?.message ?? "unknown"}`);
    }
    return {
      content: body?.choices?.[0]?.message?.content ?? "",
      status: res.status,
      tokens: {
        input: body?.usage?.prompt_tokens,
        output: body?.usage?.completion_tokens,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the first {...} JSON object from a model response (handles stray prose). */
function extractJsonObject(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Run LLM structured extraction on a document's plain text. Returns the
 * schema-validated structured result, or null when: disabled, network error,
 * non-JSON response, or schema validation fails after a retry. Never throws.
 */
export async function structuredExtract(text: string): Promise<StructuredExtraction | null> {
  const config = llmConfig();
  if (!config) return null;
  const start = Date.now();

  const userMessage = `Document text:\n\n${text.slice(0, 20_000)}`;
  let attempts = 0;
  let lastValidationFailed = false;
  let lastStatus: number | null = null;
  let tokens: LLMCallLog["tokens"];

  while (attempts < 2) {
    attempts += 1;
    const messages: { role: string; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];
    if (attempts > 1) {
      messages.push({
        role: "user",
        content: "Your previous response did not match the required JSON schema. Return ONLY valid JSON matching the schema exactly.",
      });
    }

    const result = await chatCompletion(config, messages);
    lastStatus = result.status;
    tokens = result.tokens;
    if (!result.content) continue;

    const parsed = extractJsonObject(result.content);
    const validated = STRUCTURED_EXTRACTION_SCHEMA.safeParse(parsed);
    if (validated.success) {
      logCall({
        promptVersion: STRUCTURED_PROMPT_VERSION,
        model: config.model,
        ok: true,
        status: lastStatus,
        latencyMs: Date.now() - start,
        attempts,
        validationFailed: false,
        tokens,
      });
      return validated.data;
    }
    lastValidationFailed = true;
  }

  logCall({
    promptVersion: STRUCTURED_PROMPT_VERSION,
    model: config.model,
    ok: false,
    status: lastStatus,
    latencyMs: Date.now() - start,
    attempts,
    validationFailed: lastValidationFailed,
    tokens,
  });
  return null;
}

/** Convenience alias so the pipeline can ask "is LLM configured?" at the call site. */
export function structuredExtractionAvailable(): boolean {
  return llmExtractionEnabled();
}

export type { CanonicalRiskKind };