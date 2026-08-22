// WT-4: map the deterministic AnalysisResult into the canonical obligation/event
// schema. Every extracted fact becomes a ProvenanceFact row (source quote +
// offsets); obligations carry confidence + verification tier so the alert gate
// (§5.4 of PHASE0_1_PLAN.md) can be enforced deterministically.

import type { AnalysisResult, RiskKind } from "@/lib/analysis";
import type { StructuredExtraction } from "@/lib/llm-extract";
import { parseDeadline } from "@/lib/dates";

export const RISK_KINDS = [
  "price_increase",
  "auto_renewal",
  "forgotten_trial",
  "refund_due",
  "deadline",
  "incorrect_charge",
  "none",
] as const;
export type CanonicalRiskKind = (typeof RISK_KINDS)[number];

export type ObligationKind =
  | "subscription"
  | "contract"
  | "bill"
  | "refund"
  | "warranty"
  | "insurance"
  | "renewal"
  | "trial"
  | "other";

export const OBLIGATION_KINDS: readonly ObligationKind[] = [
  "subscription",
  "contract",
  "bill",
  "refund",
  "warranty",
  "insurance",
  "renewal",
  "trial",
  "other",
];

// The deterministic analysis engine only emits a subset; keep the canonical
// vocabulary closed so schema evolution stays explicit.
const RISK_MAP: Record<RiskKind, CanonicalRiskKind> = {
  price_increase: "price_increase",
  subscription: "auto_renewal",
  trial: "forgotten_trial",
  cancellation: "refund_due",
  none: "none",
};

const OBLIGATION_KIND_MAP: Record<RiskKind, ObligationKind> = {
  price_increase: "subscription",
  subscription: "subscription",
  trial: "trial",
  cancellation: "refund",
  none: "other",
};

export interface CanonicalObligationInput {
  kind: ObligationKind;
  counterpartyName: string | null;
  amountCents: number | null;
  currency?: string;
  interval: string | null;
  startDate: string | null;
  renewalDate: string | null;
  noticeDeadlineDate: string | null;
  expiryDate: string | null;
  cancellationNoticeDays: number | null;
  autoRenews: boolean | null;
  termsQuote: string | null;
  riskType: CanonicalRiskKind;
  exposureLowCents: number | null;
  exposureHighCents: number | null;
  exposureAssumption: string | null;
  dueDate: string | null;
  verification: "certain" | "conditional" | "hypothetical";
  confidence: number;
  status?: string;
  userNote?: string | null;
}

export interface CanonicalDocumentInput {
  source: string;
  filename: string | null;
  contentType: string | null;
  extractedText: string;
  extractionMethod?: string;
  contentHash?: string | null;
}

export interface ProvenanceFactInput {
  label: string;
  value: string;
  quote: string;
  offsetStart: number | null;
  offsetEnd: number | null;
  confidence: number | null;
}

/** Normalize a counterparty name into a dedupe key ("Adobe" vs "Adobe Inc"). */
export function normalizeCompany(name: string | null): string | null {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(inc|llc|ltd|corp|corporation|co)\b/g, "")
    .trim();
}

/** Convert a risk kind from the deterministic engine into the canonical vocabulary. */
export function toCanonicalRiskKind(kind: RiskKind): CanonicalRiskKind {
  return RISK_MAP[kind];
}

export function toObligationKind(kind: RiskKind): ObligationKind {
  return OBLIGATION_KIND_MAP[kind];
}

/** Deterministic confidence: grounded facts raise it; risk kind lowers it. */
export function confidenceFor(analysis: Pick<AnalysisResult, "confidence" | "kind" | "facts">): number {
  const factCount = analysis.facts.length;
  let base = factCount > 0 ? 0.75 : 0.2;
  if (analysis.confidence === "certain") base = 0.92;
  else if (analysis.confidence === "conditional") base = 0.6;
  if (analysis.kind === "none") base = Math.min(base, 0.4);
  return Math.max(0, Math.min(1, base));
}

function toDate(value: string | null): string | null {
  if (!value) return null;
  // WT-3: the deterministic engine emits human-readable dates ("October 14").
  // parseDeadline anchors them to the next real occurrence (ISO) so the
  // notification sweep can use a real due date instead of a label.
  const date = parseDeadline(value);
  return date ? date.toISOString() : null;
}

/** Build the canonical inputs from a deterministic AnalysisResult. */
export function toCanonical(
  result: AnalysisResult,
  _document: CanonicalDocumentInput,
): { obligation: CanonicalObligationInput; facts: ProvenanceFactInput[] } {
  void _document;
  const riskType = toCanonicalRiskKind(result.kind);
  const facts: ProvenanceFactInput[] = result.facts.map((f) => ({
    label: factLabel(f.label),
    value: f.value,
    quote: f.source,
    offsetStart: f.offset ? f.offset[0] : null,
    offsetEnd: f.offset ? f.offset[1] : null,
    confidence: factConfidence(f.label),
  }));

  const obligation: CanonicalObligationInput = {
    kind: toObligationKind(result.kind),
    counterpartyName: result.counterparty,
    amountCents: result.exposureCentsPerYear ?? null,
    interval: result.exposureCentsPerYear !== null ? "yearly" : null,
    startDate: null,
    renewalDate: toDate(result.deadline),
    noticeDeadlineDate: toDate(result.deadline),
    expiryDate: null,
    cancellationNoticeDays: null,
    autoRenews: result.kind === "subscription" || result.kind === "trial" ? true : null,
    termsQuote: facts.find((f) => f.label === "cancellation_terms")?.quote ?? null,
    riskType,
    exposureLowCents: result.exposureLowCentsPerYear,
    exposureHighCents: result.exposureHighCentsPerYear,
    exposureAssumption: result.exposureAssumption,
    dueDate: toDate(result.deadline),
    verification: result.confidence,
    confidence: confidenceFor(result),
    status: "open",
  };

  return { obligation, facts };
}

/** Map the engine's human fact labels into canonical snake_case labels. */
export function factLabel(label: string): string {
  switch (label) {
    case "Amount":
      return "amount";
    case "Provider":
      return "counterparty";
    case "Deadline":
      return "deadline";
    case "Renewal clause":
      return "renewal_clause";
    case "Trial":
      return "trial";
    case "Cancellation terms":
      return "cancellation_terms";
    case "Price change":
      return "price_change";
    default:
      return label.toLowerCase().replace(/\s+/g, "_");
  }
}

export function factConfidence(label: string): number {
  return label === "Amount" || label === "Provider" || label === "Deadline" ? 0.9 : 0.6;
}

// ─── LLM structured extraction → canonical (WT-3) ────────────────────────────

/**
 * Map a schema-validated LLM structured extraction into the canonical
 * obligation + provenance rows. This is the "LLM as extractor" path: the
 * model provides ISO dates, per-field confidence, and precise amounts; the
 * deterministic risk logic still gates what reaches the user (the response
 * contract and alert gate live in the deterministic engine).
 */
export function toCanonicalStructured(
  s: StructuredExtraction,
  document: CanonicalDocumentInput,
): { obligation: CanonicalObligationInput; facts: ProvenanceFactInput[] } {
  const facts: ProvenanceFactInput[] = s.facts.map((f) => ({
    label: f.label.toLowerCase().replace(/\s+/g, "_"),
    value: f.value,
    quote: f.quote,
    offsetStart: f.offsetStart,
    offsetEnd: f.offsetEnd,
    confidence: f.confidence,
  }));

  // The model's risk type maps straight into the canonical vocabulary.
  const riskType = s.risk.type;
  const kindMap: Record<string, ObligationKind> = {
    subscription: "subscription",
    bill: "bill",
    contract: "contract",
    receipt: "other",
    refund: "refund",
    notice: "other",
    other: "other",
  };

  const noticeDeadline = s.dates.noticeDeadlineDate ?? s.dates.dueDate;
  const dueDate = s.dates.dueDate ?? noticeDeadline;

  const obligation: CanonicalObligationInput = {
    kind: kindMap[s.documentKind] ?? "other",
    counterpartyName: s.counterparty?.name ?? null,
    amountCents: s.amount?.cents ?? null,
    currency: s.amount?.currency ?? "USD",
    interval: s.amount?.interval ?? null,
    startDate: s.dates.startDate,
    renewalDate: s.dates.renewalDate,
    noticeDeadlineDate: noticeDeadline,
    expiryDate: s.dates.expiryDate,
    cancellationNoticeDays: s.cancellationTerms.noticePeriodDays,
    autoRenews: s.cancellationTerms.autoRenews,
    termsQuote: s.cancellationTerms.quote,
    riskType,
    exposureLowCents: s.risk.exposureLowCents,
    exposureHighCents: s.risk.exposureHighCents,
    exposureAssumption: s.risk.exposureAssumption,
    dueDate,
    verification: s.risk.verification,
    confidence: s.risk.confidence,
    status: "open",
  };

  // If the model produced no facts, synthesize minimal provenance from the
  // counterparty + amount so the obligation is never a bare row.
  if (facts.length === 0) {
    if (s.counterparty?.name) {
      facts.push({
        label: "counterparty",
        value: s.counterparty.name,
        quote: document.extractedText.slice(0, 160),
        offsetStart: null,
        offsetEnd: null,
        confidence: s.counterparty.confidence,
      });
    }
    if (s.amount?.cents != null) {
      facts.push({
        label: "amount",
        value: `${s.amount.cents} cents`,
        quote: document.extractedText.slice(0, 160),
        offsetStart: null,
        offsetEnd: null,
        confidence: s.amount.confidence,
      });
    }
  }

  return { obligation, facts };
}
