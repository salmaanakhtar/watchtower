import { describe, expect, it, vi } from "vitest";
import { parseEml, extractDocumentText, extractPdfText } from "@/lib/extraction";

function makeMinimalPdf(text: string): Buffer {
  const objs = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${100} >> stream\nBT /F1 18 Tf 72 720 Td (${text}) Tj ET\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(content));
    content += o + "\n";
  }
  const xrefStart = Buffer.byteLength(content);
  content += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    content += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  content += "trailer << /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF";
  return Buffer.from(content, "utf8");
}

describe("extractPdfText", () => {
  it("extracts text from a real minimal PDF", async () => {
    const pdf = makeMinimalPdf("Your plan renews at 9.99 per month.");
    const result = await extractPdfText(pdf);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("pdf-parse");
    expect(result!.text).toContain("9.99");
  });

  it("returns null for garbage bytes", async () => {
    expect(await extractPdfText(Buffer.from("%PDF-1.4\n1 0 obj\n<<fake>>"))).toBeNull();
  });
});

describe("parseEml", () => {
  it("extracts a plain-text body", () => {
    const eml = [
      "From: billing@example.com",
      "To: me@example.com",
      "Subject: Your plan renews",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Your Adobe plan renews on October 14 at $19.99/month.",
      "",
    ].join("\n");
    expect(parseEml(Buffer.from(eml))).toContain("$19.99/month");
  });

  it("decodes quoted-printable text/plain", () => {
    const eml = [
      "Subject: renew",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Renew at $9.99/mo before October 14.",
      "",
    ].join("\n");
    const out = parseEml(Buffer.from(eml));
    expect(out).toContain("$9.99/mo");
  });

  it("extracts the text/plain part of multipart/alternative over HTML", () => {
    const eml = [
      "Subject: bill",
      'Content-Type: multipart/alternative; boundary="sep"',
      "",
      "--sep",
      "Content-Type: text/plain",
      "",
      "Your bill renews at $850 per year.",
      "--sep",
      "Content-Type: text/html",
      "",
      "<p>Your bill renews at <b>$999</b> per year.</p>",
      "--sep--",
      "",
    ].join("\n");
    const out = parseEml(Buffer.from(eml));
    expect(out).toContain("$850 per year");
    expect(out).not.toContain("$999");
  });

  it("falls back to stripped HTML when no text/plain part exists", () => {
    const eml = [
      'Content-Type: multipart/alternative; boundary="sep"',
      "",
      "--sep",
      "Content-Type: text/html",
      "",
      "<p>Renewal at <b>$19.99</b>/month.</p>",
      "--sep--",
      "",
    ].join("\n");
    const out = parseEml(Buffer.from(eml));
    expect(out).toContain("$19.99/month");
  });

  it("returns null for non-email bytes", () => {
    expect(parseEml(Buffer.from("random binary \u0000\u0001\u0002 data"))).toBeNull();
  });
});

describe("extractDocumentText", () => {
  it("passes raw text through for text-ish uploads", async () => {
    const out = await extractDocumentText({
      bytes: Buffer.from("x"),
      decodedText: "Your plan renews at $9.99/month.",
      contentType: "text/plain",
      filename: "a.txt",
    });
    expect(out!.method).toBe("raw");
    expect(out!.text).toContain("$9.99");
  });

  it("routes PDFs through pdfjs-dist", async () => {
    const pdf = makeMinimalPdf("Insurance renews November 1.");
    const out = await extractDocumentText({
      bytes: pdf,
      decodedText: null,
      contentType: "application/pdf",
      filename: "b.pdf",
    });
    expect(out!.method).toBe("pdf-parse");
    expect(out!.text).toContain("November 1");
  });

  it("routes .eml through the RFC822 parser", async () => {
    const eml = ["Subject: renewal", "", "Renew on October 14 at $19.99/month.", ""].join("\n");
    const out = await extractDocumentText({
      bytes: Buffer.from(eml),
      decodedText: null,
      contentType: "message/rfc822",
      filename: "c.eml",
    });
    expect(out!.method).toBe("eml");
    expect(out!.text).toContain("$19.99");
  });

  it("returns null when nothing readable is found", async () => {
    expect(
      await extractDocumentText({
        bytes: Buffer.from("%PDF-1.4\nfake"),
        decodedText: null,
        contentType: "application/pdf",
        filename: "d.pdf",
      }),
    ).toBeNull();
  });
});

describe("ocrImage", () => {
  it("returns OCR text when tesseract.js loads", async () => {
    const worker = { recognize: vi.fn(async () => ({ data: { text: " ADOBE RENEWS $19.99 PER MONTH " } })), terminate: vi.fn() };
    vi.doMock("tesseract.js", () => ({ createWorker: vi.fn(async () => worker) }));
    const mod = await import("@/lib/extraction");
    expect(await mod.ocrImage(Buffer.from("png-bytes"))).toMatchObject({
      method: "ocr",
      text: "ADOBE RENEWS $19.99 PER MONTH",
    });
    vi.doUnmock("tesseract.js");
  });

  it("returns null when the worker throws", async () => {
    vi.doMock("tesseract.js", () => ({
      createWorker: vi.fn(async () => {
        throw new Error("ocr engine unavailable");
      }),
    }));
    const mod = await import("@/lib/extraction");
    expect(await mod.ocrImage(Buffer.from("png-bytes"))).toBeNull();
    vi.doUnmock("tesseract.js");
  });
});