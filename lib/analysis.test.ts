import { describe, expect, it } from "vitest";
import { analyzeText, extractFacts, moneyProtectedLabel } from "@/lib/analysis";

describe("analyzeText", () => {
  it("returns a none-result for empty input", () => {
    const r = analyzeText("");
    expect(r.kind).toBe("none");
    expect(r.facts).toEqual([]);
    expect(r.recommendation).toContain("Paste");
  });

  it("detects a subscription renewal with monthly amount", () => {
    const text =
      "Your Adobe Creative Cloud plan renews on October 14 at $19.99/month. Cancel before the renewal.";
    const r = analyzeText(text);
    expect(r.kind).toBe("subscription");
    expect(r.counterparty).toContain("Adobe");
    expect(r.exposureCentsPerYear).toBe(Math.round(19.99 * 12 * 100));
    expect(r.deadline).toContain("October 14");
    expect(r.confidence).toBe("certain");
    expect(r.facts.some((f) => f.label === "Amount")).toBe(true);
  });

  it("detects a price increase", () => {
    const text =
      "Your plan will increase from $9.99 to $14.99 per month starting November 1. This renewal price is higher.";
    const r = analyzeText(text);
    expect(r.kind).toBe("price_increase");
    expect(r.exposureCentsPerYear).toBe(Math.round(14.99 * 12 * 100));
    expect(r.deadline).toContain("November 1");
  });

  it("detects a trial ending", () => {
    const text = "Your free trial ends on December 5. You will be billed $12.99/month after.";
    const r = analyzeText(text);
    expect(r.kind).toBe("trial");
    expect(r.deadline).toContain("December 5");
  });

  it("detects cancellation/refund notices", () => {
    const text = "We have cancelled your subscription. Your refund of $45.00 will be processed.";
    const r = analyzeText(text);
    expect(r.kind).toBe("cancellation");
    expect(r.recommendation).toContain("refund");
  });

  it("returns none for benign text", () => {
    const r = analyzeText("Hello, thank you for subscribing to our newsletter. Stay tuned.");
    expect(r.kind).toBe("none");
    expect(r.exposureCentsPerYear).toBeNull();
  });

  it("sets conditional confidence when amount missing but renewal present", () => {
    const r = analyzeText("Your subscription will renew automatically.");
    expect(r.kind).toBe("subscription");
    expect(r.confidence).toBe("conditional");
  });

  it("exposes a conservative range with an explicit assumption (monthly rate)", () => {
    const r = analyzeText("Your Adobe plan renews at $9.99/month on November 1.");
    expect(r.exposureLowCentsPerYear).toBe(Math.round(9.99 * 12 * 100));
    expect(r.exposureHighCentsPerYear).toBe(Math.round(9.99 * 12 * 100));
    expect(r.exposureAssumption).toContain("$9.99/month × 12 months");
    expect(r.exposureAssumption).toContain("$120/year");
  });

  it("detects a forgotten-trial conversion with deadline and rate", () => {
    const r = analyzeText(
      "Your 14-day free trial of GymBox ends on March 15. After that you will be billed $49.99/month.",
    );
    expect(r.kind).toBe("trial");
    expect(r.deadline).toContain("March 15");
    expect(r.exposureCentsPerYear).toBe(Math.round(49.99 * 12 * 100));
    expect(r.confidence).toBe("conditional");
  });

  it("classifies a refund notice as cancellation and exposes no recurring cost", () => {
    const r = analyzeText(
      "We have processed your refund of $120.00 for the cancelled Annual Plan. No further charges.",
    );
    expect(r.kind).toBe("cancellation");
    expect(r.exposureCentsPerYear).toBeNull();
  });

  it("keeps certainty when both renewal and amount are present", () => {
    const r = analyzeText("Your plan renews on December 1 at $12.99/month.");
    expect(r.confidence).toBe("certain");
  });
});

describe("extractFacts", () => {
  it("records source quotes with character offsets", () => {
    const facts = extractFacts(
      "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.",
    );
    const amount = facts.find((f) => f.label === "Amount");
    expect(amount).toBeTruthy();
    expect(amount!.source).toContain("$19.99/month");
    expect(amount!.offset).toBeTruthy();
    const [start, end] = amount!.offset!;
    const slice = "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.".slice(
      start,
      end,
    );
    expect(slice).toBe("$19.99/month");
  });

  it("includes provider, deadline, and renewal clause facts", () => {
    const facts = extractFacts(
      "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.",
    );
    const labels = facts.map((f) => f.label);
    expect(labels).toContain("Provider");
    expect(labels).toContain("Deadline");
    expect(labels).toContain("Renewal clause");
  });
});

describe("moneyProtectedLabel", () => {
  it("formats cents into dollars", () => {
    expect(moneyProtectedLabel(239880)).toBe("$2,399");
  });
  it("handles null", () => {
    expect(moneyProtectedLabel(null)).toBe("—");
  });
});
