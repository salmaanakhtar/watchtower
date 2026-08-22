import { describe, expect, it } from "vitest";
import {
  decryptField,
  encryptField,
  hashForLookup,
  PREFIX,
} from "@/lib/crypto";

describe("field encryption (WT-8)", () => {
  it("round-trips a plaintext", () => {
    const enc = encryptField("user@example.com");
    expect(enc).toMatch(new RegExp(`^${PREFIX}\\.`));
    expect(enc).not.toContain("user@example.com");
    expect(decryptField(enc)).toBe("user@example.com");
  });

  it("returns null for null/undefined", () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(decryptField(null)).toBeNull();
  });

  it("returns legacy plaintext unchanged (pre-WT-8 rows)", () => {
    expect(decryptField("plain-email@example.com")).toBe("plain-email@example.com");
  });

  it("is randomized: same input encrypts differently each time", () => {
    const a = encryptField("same");
    const b = encryptField("same");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("same");
    expect(decryptField(b)).toBe("same");
  });

  it("handles tampered envelopes without throwing", () => {
    const enc = encryptField("secret")!;
    const parts = enc.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("AAAA").toString("base64url")].join(".");
    const out = decryptField(tampered);
    // Fails safe: never throws; either null or the raw value (never a wrong plaintext).
    expect(["secret"]).not.toContain(out);
  });
});

describe("lookup hashes (WT-8)", () => {
  it("is deterministic and case-normalized by caller", () => {
    expect(hashForLookup("a@b.com")).toBe(hashForLookup("a@b.com"));
    expect(hashForLookup("a@b.com")).not.toBe(hashForLookup("a@c.com"));
  });

  it("does not leak the plaintext", () => {
    const h = hashForLookup("victim@example.com");
    expect(h).not.toContain("victim");
  });
});
