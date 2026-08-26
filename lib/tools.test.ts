import { describe, expect, it } from "vitest";
import { TOOLS, TOOL_SLUGS, allTools, getTool, isValidToolSlug } from "@/lib/tools";
import { analyzeText } from "@/lib/analysis";

describe("WT-15 tool definitions", () => {
  it("registers both SEO tools with valid slugs", () => {
    expect(TOOL_SLUGS).toEqual([
      "contract-renewal-analyzer",
      "cancellation-deadline-checker",
    ]);
    for (const slug of TOOL_SLUGS) {
      expect(isValidToolSlug(slug)).toBe(true);
      expect(getTool(slug)).not.toBeNull();
    }
  });

  it("rejects unknown slugs", () => {
    expect(isValidToolSlug("nope")).toBe(false);
    expect(isValidToolSlug("")).toBe(false);
    expect(getTool("nope")).toBeNull();
    expect(getTool(null)).toBeNull();
  });

  it("every tool has copy + SEO metadata + a preseeded example", () => {
    for (const t of allTools()) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.headline.length).toBeGreaterThan(0);
      expect(t.subheadline.length).toBeGreaterThan(0);
      expect(t.sampleText.length).toBeGreaterThan(20);
      expect(t.metaTitle.length).toBeGreaterThan(0);
      expect(t.metaDescription.length).toBeGreaterThan(0);
      expect(t.badge.length).toBeGreaterThan(0);
    }
  });

  it("each tool's example produces the expected risk kind (the tool's promise)", () => {
    // Contract renewal analyzer: an annual contract that auto-renews with a
    // price increase → price_increase.
    const contract = analyzeText(TOOLS["contract-renewal-analyzer"].sampleText);
    expect(contract.kind).toBe("price_increase");
    expect(contract.deadline).toBeTruthy();
    // The deterministic engine uses the FIRST amount found ($960 current
    // annual rate, before the announced increase) × 1 year.
    expect(contract.exposureCentsPerYear).toBe(96000);

    // Cancellation deadline checker: a membership with a cancellation date →
    // subscription.
    const cancel = analyzeText(TOOLS["cancellation-deadline-checker"].sampleText);
    expect(cancel.kind).toBe("subscription");
    expect(cancel.deadline).toBeTruthy();
    expect(cancel.exposureCentsPerYear).toBe(47988); // $39.99/mo × 12
  });
});
