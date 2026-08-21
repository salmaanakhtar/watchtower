import { describe, expect, it } from "vitest";
import { hashVariant } from "@/lib/variant";
import { VARIANTS } from "@/lib/variants";

describe("hashVariant", () => {
  it("always returns a valid variant", () => {
    for (const key of ["a", "b", "c", "1.2.3.4", "::1", "", "long-key-".repeat(10)]) {
      const v = hashVariant(key);
      expect(["A", "B", "C", "D"]).toContain(v);
    }
  });

  it("is deterministic for the same key", () => {
    expect(hashVariant("203.0.113.7")).toBe(hashVariant("203.0.113.7"));
  });

  it("distributes across all four variants", () => {
    const counts = new Set<string>();
    for (let i = 0; i < 400; i++) counts.add(hashVariant(`ip-${i}`));
    expect(counts.size).toBe(4);
  });
});

describe("variants", () => {
  it("defines exactly 4 variants with all copy fields", () => {
    expect(Object.keys(VARIANTS)).toEqual(["A", "B", "C", "D"]);
    for (const v of Object.values(VARIANTS)) {
      expect(v.badge).toBeTruthy();
      expect(v.headline).toBeTruthy();
      expect(v.subheadline).toBeTruthy();
      expect(v.cta).toBeTruthy();
    }
  });
});
