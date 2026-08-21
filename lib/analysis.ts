// Deterministic, rule-based document analysis for Phase 0.
// This is the "manual/semi-manual" stand-in: real users get a plausible,
// grounded analysis based on extracted facts. LLM extraction lands in Phase 1.

export interface ExtractedFact {
  label: string;
  value: string;
  source: string;
}

export interface AnalysisResult {
  kind: string;
  counterparty: string | null;
  title: string;
  whyItMatters: string;
  exposureCentsPerYear: number | null;
  exposureLabel: string;
  deadline: string | null;
  recommendation: string;
  confidence: "certain" | "conditional" | "hypothetical";
  facts: ExtractedFact[];
}

const MONTHLY_RE = /\$\s?(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:\/|\bper)\s?mo(?:nth)?\b/i;
const YEARLY_RE = /\$\s?(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:\/|\bper)\s?yr(?:ear)?\b/i;
const RENEW_RE = /renew/i;
const TRIAL_RE = /trial/i;
const CANCEL_RE = /cancel/i;
const PRICE_INCREASE_RE = /(?:increase|raise|goes up|more|higher)\b/i;
const DATE_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i;

const DATE_SOURCE_RE =
  /(?:on|by|before|effective|starting)\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?)/i;

function parseMoney(match: string): number | null {
  const cleaned = match.replace(",", ".").replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function firstDate(text: string): string | null {
  const m = text.match(DATE_SOURCE_RE) ?? text.match(DATE_RE);
  return m ? m[0].replace(/\b(?:on|by|before|effective|starting)\s+/i, "") : null;
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
      exposureLabel: "—",
      deadline: null,
      recommendation: "Paste the full document and try again.",
      confidence: "hypothetical",
      facts: [],
    };
  }

  const facts: ExtractedFact[] = [];
  const hasRenewal = RENEW_RE.test(text);
  const hasTrial = TRIAL_RE.test(text);
  const hasCancel = CANCEL_RE.test(text);
  const hasPriceIncrease = PRICE_INCREASE_RE.test(text);

  const monthly = text.match(MONTHLY_RE);
  const yearly = text.match(YEARLY_RE);
  const amountPerMonth = monthly ? parseMoney(monthly[1]) : null;
  const amountPerYear = yearly ? parseMoney(yearly[1]) : null;

  if (amountPerMonth !== null) {
    facts.push({
      label: "Amount",
      value: `$${amountPerMonth.toFixed(2)}/month`,
      source: monthly![0],
    });
  }
  if (amountPerYear !== null) {
    facts.push({
      label: "Amount",
      value: `$${amountPerYear.toFixed(2)}/year`,
      source: yearly![0],
    });
  }
  if (hasRenewal) {
    facts.push({ label: "Renewal clause", value: "present", source: text.slice(0, 80) });
  }
  if (hasTrial) {
    facts.push({ label: "Trial", value: "mentioned", source: text.slice(0, 80) });
  }
  if (hasCancel) {
    facts.push({ label: "Cancellation terms", value: "mentioned", source: text.slice(0, 80) });
  }

  const deadline = firstDate(text);
  if (deadline) facts.push({ label: "Deadline", value: deadline, source: text.slice(0, 120) });

  const isPriceIncrease = hasPriceIncrease && (amountPerMonth !== null || amountPerYear !== null);
  const isSubscription = hasRenewal || hasTrial || (amountPerMonth !== null && hasCancel);
  // A document with both a trial and a renewal is a trial-to-paid conversion (trial wins).
  const isTrialConversion = hasTrial && (hasRenewal || amountPerMonth !== null);

  const counterparty = extractCounterparty(text);
  if (counterparty) facts.push({ label: "Provider", value: counterparty, source: text.slice(0, 120) });

  // Exposure math (conservative, deterministic)
  let exposureCentsPerYear: number | null = null;
  let exposureLabel = "No recurring exposure detected";
  if (amountPerMonth !== null) {
    exposureCentsPerYear = Math.round(amountPerMonth * 12 * 100);
    exposureLabel = `~$${(amountPerMonth * 12).toFixed(0)}/year if this renews`;
  } else if (amountPerYear !== null) {
    exposureCentsPerYear = Math.round(amountPerYear * 100);
    exposureLabel = `~$${amountPerYear.toFixed(0)}/year`;
  }

  // Recommendation logic (deterministic rules)
  let recommendation: string;
  let title: string;
  let whyItMatters: string;
  let kind: string;
  let confidence: AnalysisResult["confidence"];

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
    exposureLabel,
    deadline,
    recommendation,
    confidence,
    facts,
  };
}

const COUNTERPARTY_RE =
  /(?:from|by|at|with)\s+([A-Z][A-Za-z0-9&.' -]{2,40}?)(?=\s+(?:regarding|the|your|we|you|\.)|$)/i;

function extractCounterparty(text: string): string | null {
  // Prefer explicit preposition match, then fall back to "Your <Company> ..." pattern.
  const m = text.match(COUNTERPARTY_RE);
  if (m) return m[1].trim();
  const your = text.match(/Your\s+([A-Z][A-Za-z0-9&.' -]{2,40}?)\s+(?:plan|subscription|account|policy|membership|premium)/i);
  if (your) return your[1].trim();
  return null;
}

export function moneyProtectedLabel(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
