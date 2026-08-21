// Deterministic, rule-based document analysis for Phase 0/1 (WT-2).
// This is the "manual/semi-manual" stand-in: real users get a plausible,
// grounded analysis based on extracted facts. LLM extraction lands in Phase 1.

export interface ExtractedFact {
  label: string;
  value: string;
  source: string;
  offset: [number, number] | null;
}

export type RiskKind =
  | "price_increase"
  | "subscription"
  | "trial"
  | "cancellation"
  | "none";

export interface AnalysisResult {
  kind: RiskKind;
  counterparty: string | null;
  title: string;
  whyItMatters: string;
  exposureCentsPerYear: number | null;
  exposureLowCentsPerYear: number | null;
  exposureHighCentsPerYear: number | null;
  exposureAssumption: string | null;
  exposureLabel: string;
  deadline: string | null;
  recommendation: string;
  confidence: "certain" | "conditional" | "hypothetical";
  facts: ExtractedFact[];
}

const MONTHLY_RE = /\$\s?(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:\/|\bper)\s?mo(?:nth)?\b/i;
const YEARLY_RE = /\$\s?(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:\/|\bper)\s?(?:yr|year)\b/i;
const RENEW_RE = /renew/i;
const TRIAL_RE = /trial/i;
const CANCEL_RE = /cancel/i;
const PRICE_INCREASE_RE = /(?:increase|raise|goes up|more|higher)\b/i;
const DATE_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i;

const DATE_SOURCE_RE =
  /(?:on|by|before|effective|starting)\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?)/i;

const COUNTERPARTY_RE =
  /(?:from|by|at|with)\s+([A-Z][A-Za-z0-9&.' -]{2,40}?)(?=\s+(?:regarding|the|your|we|you|\.)|$)/i;

const YOUR_COUNTERPARTY_RE =
  /Your\s+([A-Z][A-Za-z0-9&.' -]{2,40}?)\s+(?:plan|subscription|account|policy|membership|premium)/i;

function parseMoney(match: string): number | null {
  const cleaned = match.replace(",", ".").replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function firstDate(text: string): string | null {
  const m = text.match(DATE_SOURCE_RE) ?? text.match(DATE_RE);
  return m ? m[0].replace(/\b(?:on|by|before|effective|starting)\s+/i, "") : null;
}

export function extractFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const sources = [
    { label: "Amount", re: MONTHLY_RE },
    { label: "Amount", re: YEARLY_RE },
    { label: "Renewal clause", re: RENEW_RE },
    { label: "Trial", re: TRIAL_RE },
    { label: "Cancellation terms", re: CANCEL_RE },
    { label: "Price change", re: PRICE_INCREASE_RE },
    { label: "Deadline", re: DATE_SOURCE_RE },
    { label: "Provider", re: COUNTERPARTY_RE },
    { label: "Provider", re: YOUR_COUNTERPARTY_RE },
  ] as const;

  for (const { label, re } of sources) {
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (facts.some((f) => f.label === label && f.value === m[0])) continue;
    let value: string;
    let quote = m[0];
    if (label === "Amount") {
      const money = m[1] ? parseMoney(m[1]) : null;
      if (money === null) continue;
      const unit = m[0].match(/\b(?:mo|month|yr|year)\b/i)?.[0] ?? "mo";
      value = `$${money.toFixed(2)}/${unit}`;
    } else if (label === "Deadline") {
      value = m[0].replace(/\b(?:on|by|before|effective|starting)\s+/i, "");
      quote = value;
    } else if (label === "Provider") {
      value = m[1].trim();
    } else {
      value = "present";
    }
    facts.push({ label, value, source: quote, offset: [start, end] });
  }

  const renewal = facts.find((f) => f.label === "Renewal clause");
  if (renewal) {
    renewal.source = text.slice(0, 80);
    renewal.offset = [0, Math.min(80, text.length)];
  }
  const trial = facts.find((f) => f.label === "Trial");
  if (trial) {
    trial.source = text.slice(0, 80);
    trial.offset = [0, Math.min(80, text.length)];
  }
  const cancel = facts.find((f) => f.label === "Cancellation terms");
  if (cancel) {
    cancel.source = text.slice(0, 80);
    cancel.offset = [0, Math.min(80, text.length)];
  }

  return facts;
}

export function analyzeText(raw: string): AnalysisResult {
  const text = raw.trim();

  if (!text) {
    return {
      kind: "none",
      counterparty: null,
      title: "No document text provided",
      whyItMatters: "We couldn't read anything to analyze. Paste the full email or notice text.",
      exposureCentsPerYear: null,
      exposureLowCentsPerYear: null,
      exposureHighCentsPerYear: null,
      exposureAssumption: null,
      exposureLabel: "—",
      deadline: null,
      recommendation: "Paste the full document and try again.",
      confidence: "hypothetical",
      facts: [],
    };
  }

  const facts = extractFacts(text);
  const hasRenewal = RENEW_RE.test(text);
  const hasTrial = TRIAL_RE.test(text);
  const hasCancel = CANCEL_RE.test(text);
  const hasPriceIncrease = PRICE_INCREASE_RE.test(text);

  const monthly = text.match(MONTHLY_RE);
  const yearly = text.match(YEARLY_RE);
  const amountPerMonth = monthly ? parseMoney(monthly[1]) : null;
  const amountPerYear = yearly ? parseMoney(yearly[1]) : null;

  const deadline = firstDate(text);
  const counterparty = extractCounterparty(text);

  // Exposure math (conservative, deterministic): low = documented cost,
  // high = next full renewal cycle (12 months) at the documented rate.
  const exposureCentsPerYear =
    amountPerMonth !== null
      ? Math.round(amountPerMonth * 12 * 100)
      : amountPerYear !== null
        ? Math.round(amountPerYear * 100)
        : null;

  let exposureLabel = "No recurring exposure detected";
  let exposureLowCentsPerYear: number | null = null;
  let exposureHighCentsPerYear: number | null = null;
  let exposureAssumption: string | null = null;

  if (amountPerMonth !== null) {
    exposureLowCentsPerYear = Math.round(amountPerMonth * 12 * 100);
    exposureHighCentsPerYear = Math.round(amountPerMonth * 12 * 100);
    exposureAssumption = `$${amountPerMonth.toFixed(2)}/month × 12 months = $${(amountPerMonth * 12).toFixed(0)}/year if this renews`;
    exposureLabel = `~$${(amountPerMonth * 12).toFixed(0)}/year if this renews`;
  } else if (amountPerYear !== null) {
    exposureLowCentsPerYear = Math.round(amountPerYear * 100);
    exposureHighCentsPerYear = Math.round(amountPerYear * 100);
    exposureAssumption = `$${amountPerYear.toFixed(2)}/year`;
    exposureLabel = `~$${amountPerYear.toFixed(0)}/year`;
  }

  // Recommendation logic (deterministic rules)
  let recommendation: string;
  let title: string;
  let whyItMatters: string;
  let kind: RiskKind;
  let confidence: AnalysisResult["confidence"];

  const isPriceIncrease = hasPriceIncrease && (amountPerMonth !== null || amountPerYear !== null);
  const isSubscription = hasRenewal || hasTrial || (amountPerMonth !== null && hasCancel);
  // A document with both a trial and a renewal is a trial-to-paid conversion (trial wins).
  const isTrialConversion = hasTrial && (hasRenewal || amountPerMonth !== null);

  if (isPriceIncrease) {
    kind = "price_increase";
    title = "This looks like a price increase";
    whyItMatters =
      "Recurring prices that rise silently are the most common way money leaks. A small monthly bump can cost hundreds per year.";
    recommendation = deadline
      ? `Contact them before ${deadline} and confirm the new price — ask whether the old price can be kept.`
      : "Contact them now and confirm the new price — ask whether the old price can be kept.";
    confidence = amountPerMonth !== null ? "certain" : "conditional";
  } else if (hasTrial || isTrialConversion) {
    kind = "trial";
    title = "Free trial ending";
    whyItMatters = "Free trials often convert to paid plans automatically the day they end.";
    recommendation = deadline
      ? `Cancel before ${deadline} if you don't want to be billed.`
      : "Find the trial end date before the first charge.";
    confidence = deadline ? "conditional" : "hypothetical";
  } else if (isSubscription) {
    kind = "subscription";
    title = "Recurring subscription detected";
    whyItMatters =
      "Subscriptions that renew automatically are easy to forget. If you're not using it, the renewal is pure loss.";
    recommendation = deadline
      ? `Decide before ${deadline}: cancel to stop the next charge, or keep it and set a reminder.`
      : "Check whether you still use this service — cancel if not.";
    confidence = deadline ? "certain" : "conditional";
  } else if (hasCancel) {
    kind = "cancellation";
    title = "Cancellation or refund notice";
    whyItMatters = "Cancellation confirmations and refund notices are easy to lose track of.";
    recommendation = deadline
      ? `Follow up before ${deadline} to confirm the refund or cancellation landed.`
      : "Check that the cancellation or refund was actually processed.";
    confidence = "conditional";
  } else {
    kind = "none";
    title = "No clear money risk found";
    whyItMatters =
      "We didn't find a renewal, price, or deadline in this document. It may still matter — check for amounts or dates.";
    recommendation = "If this is a bill or contract, make sure the amount and dates are what you expect.";
    confidence = "hypothetical";
  }

  return {
    kind,
    counterparty,
    title,
    whyItMatters,
    exposureCentsPerYear,
    exposureLowCentsPerYear,
    exposureHighCentsPerYear,
    exposureAssumption,
    exposureLabel,
    deadline,
    recommendation,
    confidence,
    facts,
  };
}

function extractCounterparty(text: string): string | null {
  // Prefer explicit preposition match, then fall back to "Your <Company> ..." pattern.
  const m = text.match(COUNTERPARTY_RE);
  if (m) return m[1].trim();
  const your = text.match(YOUR_COUNTERPARTY_RE);
  if (your) return your[1].trim();
  return null;
}

export function moneyProtectedLabel(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
