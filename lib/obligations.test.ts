import { describe, expect, it } from "vitest";
import {
  confidenceFor,
  factConfidence,
  factLabel,
  normalizeCompany,
  toCanonical,
  toCanonicalRiskKind,
  toObligationKind,
} from "@/lib/obligations";
import { analyzeText, extractFacts } from "@/lib/analysis";

describe("normalizeCompany", () => {
  it("dedupes legal suffixes", () => {
    expect(normalizeCompany("Adobe Inc")).toBe("adobe");
    expect(normalizeCompany("Adobe, LLC")).toBe("adobe");
    expect(normalizeCompany("Stripe Corporation")).toBe("stripe");
  });
  it("returns null for empty names", () => {
    expect(normalizeCompany(null)).toBeNull();
    expect(normalizeCompany("")).toBeNull();
  });
});

describe("toCanonicalRiskKind / toObligationKind", () => {
  it("maps engine risk kinds into the canonical vocabulary", () => {
    expect(toCanonicalRiskKind("price_increase")).toBe("price_increase");
    expect(toCanonicalRiskKind("subscription")).toBe("auto_renewal");
    expect(toCanonicalRiskKind("trial")).toBe("forgotten_trial");
    expect(toCanonicalRiskKind("cancellation")).toBe("refund_due");
    expect(toCanonicalRiskKind("none")).toBe("none");
    expect(toObligationKind("subscription")).toBe("subscription");
    expect(toObligationKind("trial")).toBe("trial");
    expect(toObligationKind("cancellation")).toBe("refund");
    expect(toObligationKind("none")).toBe("other");
  });
});

describe("confidenceFor", () => {
  it("is high when the finding is certain and grounded", () => {
    const r = analyzeText("Your Adobe plan renews on October 14 at $19.99/month.");
    expect(confidenceFor(r)).toBeGreaterThanOrEqual(0.9);
  });
  it("is lower for conditional findings", () => {
    const r = analyzeText("Your subscription will renew automatically.");
    expect(r.confidence).toBe("conditional");
    expect(confidenceFor(r)).toBeGreaterThanOrEqual(0.5);
    expect(confidenceFor(r)).toBeLessThan(0.9);
  });
  it("is low for no-risk findings", () => {
    const r = analyzeText("Hello, thank you for subscribing to our newsletter.");
    expect(confidenceFor(r)).toBeLessThanOrEqual(0.4);
  });
});

describe("toCanonical", () => {
  it("maps a subscription analysis into canonical obligation + provenance facts", () => {
    const text = "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.";
    const result = analyzeText(text);
    const { obligation, facts } = toCanonical(result, {
      source: "paste",
      filename: null,
      contentType: "text/plain",
      extractedText: text,
    });

    expect(obligation.kind).toBe("subscription");
    expect(obligation.counterpartyName).toContain("Adobe");
    expect(obligation.amountCents).toBe(Math.round(19.99 * 12 * 100));
    expect(obligation.interval).toBe("yearly");
    expect(obligation.riskType).toBe("auto_renewal");
    expect(obligation.autoRenews).toBe(true);
    expect(obligation.verification).toBe("certain");
    expect(obligation.confidence).toBeGreaterThanOrEqual(0.9);

    expect(facts.length).toBeGreaterThan(0);
    const amount = facts.find((f) => f.label === "amount");
    expect(amount).toBeTruthy();
    expect(amount!.quote).toContain("$19.99/month");
    expect(amount!.offsetStart).toBeTypeOf("number");
    expect(amount!.offsetEnd).toBeTypeOf("number");
    const deadline = facts.find((f) => f.label === "deadline");
    expect(deadline).toBeTruthy();
    expect(deadline!.quote).toContain("October 14");
  });

  it("maps a refund/cancellation notice into a refund obligation with no recurring exposure", () => {
    const text = "We have processed your refund of $120.00 for the cancelled Annual Plan.";
    const result = analyzeText(text);
    const { obligation, facts } = toCanonical(result, {
      source: "paste",
      filename: null,
      contentType: "text/plain",
      extractedText: text,
    });
    expect(obligation.kind).toBe("refund");
    expect(obligation.riskType).toBe("refund_due");
    expect(obligation.amountCents).toBeNull();
    expect(obligation.exposureLowCents).toBeNull();
    expect(facts.some((f) => f.label === "cancellation_terms")).toBe(true);
  });

  it("keeps provenance offsets aligned with the source text", () => {
    const text = "Your Adobe plan renews on October 14 at $19.99/month.";
    const result = analyzeText(text);
    const { facts } = toCanonical(result, {
      source: "paste",
      filename: null,
      contentType: "text/plain",
      extractedText: text,
    });
    for (const f of facts) {
      if (f.offsetStart === null || f.offsetEnd === null) continue;
      const slice = text.slice(f.offsetStart, f.offsetEnd);
      expect(slice.length).toBeGreaterThan(0);
      expect(text.includes(slice)).toBe(true);
    }
  });
});

describe("factLabel / factConfidence", () => {
  it("maps human labels to canonical snake_case", () => {
    expect(factLabel("Amount")).toBe("amount");
    expect(factLabel("Provider")).toBe("counterparty");
    expect(factLabel("Deadline")).toBe("deadline");
    expect(factLabel("Renewal clause")).toBe("renewal_clause");
    expect(factLabel("Cancellation terms")).toBe("cancellation_terms");
    expect(factLabel("Price change")).toBe("price_change");
  });
  it("scores money/provider/deadline facts higher", () => {
    expect(factConfidence("Amount")).toBe(0.9);
    expect(factConfidence("Provider")).toBe(0.9);
    expect(factConfidence("Deadline")).toBe(0.9);
    expect(factConfidence("Trial")).toBe(0.6);
  });
  it("extractFacts still produces offsets (regression guard)", () => {
    const facts = extractFacts("Your Adobe plan renews at $9.99/month on November 1.");
    const amount = facts.find((f) => f.label === "Amount");
    expect(amount!.offset).toBeTruthy();
  });
});
