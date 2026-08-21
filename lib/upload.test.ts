import { describe, expect, it } from "vitest";
import {
  contentHash,
  decodeUpload,
  extractionPending,
  MAX_UPLOAD_BYTES,
  uploadSupported,
} from "@/lib/upload";

describe("decodeUpload", () => {
  it("decodes base64 text and trims", () => {
    const b64 = Buffer.from("  Your plan renews at $9.99/month.  ").toString("base64");
    const d = decodeUpload(b64, "text/plain", "renewal.txt");
    expect(d).not.toBeNull();
    expect(d!.contentType).toBe("text/plain");
    expect(d!.decodedText).toBe("Your plan renews at $9.99/month.");
    expect(d!.filename).toBe("renewal.txt");
  });

  it("strips HTML tags for text/html uploads", () => {
    const html = "<html><body><p>Your plan renews at <b>$9.99</b>/month.</p></body></html>";
    const b64 = Buffer.from(html).toString("base64");
    const d = decodeUpload(b64, "text/html", "notice.html");
    expect(d!.decodedText).toContain("$9.99/month");
    expect(d!.decodedText).not.toContain("<b>");
  });

  it("returns null decodedText for PDFs (queued path)", () => {
    const b64 = Buffer.from("%PDF-1.4 fake").toString("base64");
    const d = decodeUpload(b64, "application/pdf", "bill.pdf");
    expect(d).not.toBeNull();
    expect(d!.decodedText).toBeNull();
    expect(extractionPending(d!.contentType)).toBe(true);
  });

  it("normalizes spoofed MIME via magic bytes", () => {
    const b64 = Buffer.from("%PDF-1.4 fake").toString("base64");
    const d = decodeUpload(b64, "application/octet-stream", "bill.pdf");
    expect(d!.contentType).toBe("application/pdf");
  });

  it("rejects malformed base64", () => {
    expect(decodeUpload("!!!not-base64!!!", "text/plain", "x.txt")).toBeNull();
  });

  it("rejects oversize uploads", () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 97);
    expect(decodeUpload(big.toString("base64"), "text/plain", "big.txt")).toBeNull();
  });

  it("rejects unknown binary types", () => {
    const b64 = Buffer.from("PK\x03\x04fake").toString("base64");
    expect(decodeUpload(b64, "application/zip", "x.zip")).toBeNull();
  });
});

describe("uploadSupported / extractionPending", () => {
  it("flags text types as supported and immediate", () => {
    expect(uploadSupported("text/plain")).toBe(true);
    expect(extractionPending("text/plain")).toBe(false);
  });

  it("flags pdf/png/jpeg/webp as queued", () => {
    for (const m of ["application/pdf", "image/png", "image/jpeg", "image/webp"]) {
      expect(uploadSupported(m)).toBe(true);
      expect(extractionPending(m)).toBe(true);
    }
  });
});

describe("contentHash", () => {
  it("is stable and sha256", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).toMatch(/^[a-f0-9]{64}$/);
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });
});
