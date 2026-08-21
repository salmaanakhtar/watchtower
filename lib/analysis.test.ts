import { describe, expect, it } from "vitest";
import { analyzeText, moneyProtectedLabel } from "@/lib/analysis";

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
});

describe("moneyProtectedLabel", () => {
  it("formats cents into dollars", () => {
    expect(moneyProtectedLabel(239880)).toBe("$2,399");
  });
  it("handles null", () => {
    expect(moneyProtectedLabel(null)).toBe("—");
  });
});
