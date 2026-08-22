// WT-3: deterministic document text extraction (ingestion → extraction layer).
//
// Strategy (PHASE0_1_PLAN §5.5): deterministic first, LLM as complement.
// This module turns raw bytes into plain text — never analysis. It handles:
//   - PDFs       → pdfjs-dist text layer (legacy build, no native deps)
//   - images     → OCR via tesseract.js (pure JS worker, eng traineddata)
//   - .eml       → deterministic RFC822 parsing (quoted-printable/base64)
//   - text-ish   → already decoded by lib/upload.ts (raw passthrough)
//
// Every extractor is defensive: it returns null on any failure so the caller
// can fall back to the honest "queued for manual review" state instead of
// analyzing garbage. The heavy libs are imported dynamically so this module
// loads cheaply and tests can mock them.

export type ExtractionMethod = "raw" | "pdf-parse" | "ocr" | "eml" | "llm";

export interface ExtractedText {
  text: string;
  method: ExtractionMethod;
  pageCount?: number;
}

export const MAX_EXTRACTED_CHARS = 50_000; // same cap as pasted text (WT-2)

/**
 * Extract text from a PDF via pdfjs-dist's text layer. Returns null when the
 * PDF is unreadable, has no text layer, or exceeds caps. Runs the legacy build
 * which works in Node without native canvas/worker setup.
 */
export async function extractPdfText(bytes: Buffer): Promise<ExtractedText | null> {
  let loadingTask: { promise: Promise<unknown>; destroy: () => Promise<void> } | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = (await loadingTask.promise) as {
      numPages: number;
      getPage(i: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }>; cleanup(): void }>;
    };

    let text = "";
    const pageCount = doc.numPages;
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText) text += (text ? "\n" : "") + pageText;
      page.cleanup();
    }

    text = text.trim();
    if (!text) return null;
    return { text: text.slice(0, MAX_EXTRACTED_CHARS), method: "pdf-parse", pageCount };
  } catch (err) {
    console.error("[wt3:extract] pdf text extraction failed", err);
    return null;
  } finally {
    // pdfjs v6: destroy the loading task, not the document proxy.
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}

/**
 * OCR an image (PNG/JPG/WebP) via tesseract.js. Downloads/loads `eng`
 * traineddata on first use (cached in TESSERACT_CACHE_PATH if set, else the
 * worker default). Returns null on any failure so callers degrade gracefully.
 */
export async function ocrImage(bytes: Buffer): Promise<ExtractedText | null> {
  try {
    const { createWorker } = await import("tesseract.js");
    const cachePath = process.env.TESSERACT_CACHE_PATH ?? undefined;
    const worker = await createWorker("eng", 1, cachePath ? { cachePath } : undefined);
    try {
      const { data } = await worker.recognize(bytes);
      const text = (data.text ?? "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      return { text: text.slice(0, MAX_EXTRACTED_CHARS), method: "ocr" };
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    console.error("[wt3:extract] image OCR failed", err);
    return null;
  }
}

// ─── .eml parsing (deterministic, no deps) ──────────────────────────────────

function decodeTransfer(body: string, encoding: string | undefined): string {
  const enc = (encoding ?? "").trim().toLowerCase();
  if (enc === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  if (enc === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  return body;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+([/.,;:!?%])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const BOUNDARY_RE = /boundary\s*=\s*"?([^";\s]+)"?/i;
const CTE_RE = /^Content-Transfer-Encoding:\s*(.+)$/im;
const CONTENT_TYPE_RE = /^Content-Type:\s*(.+)$/im;

function contentTypeOf(section: string): { type: string; boundary?: string } {
  const m = section.match(CONTENT_TYPE_RE);
  const raw = m ? m[1] : "";
  const type = raw.split(";")[0]?.trim().toLowerCase() ?? "text/plain";
  const boundary = raw.match(BOUNDARY_RE)?.[1];
  return { type, boundary };
}

function partsOf(section: string, boundary: string): string[] {
  return section
    .split(`--${boundary}`)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("--")); // drop preamble, closing "--sep--" and empties
}

/** Best-effort plain-text extraction from a raw .eml body. */
export function parseEml(bytes: Buffer): string | null {
  try {
    const raw = bytes.toString("utf8");
    const [head, ...bodyParts] = raw.split(/\r?\n\r?\n/);
    if (!head) return null;
    const body = bodyParts.join("\n\n");
    const cte = head.match(CTE_RE)?.[1]?.trim();
    const { type, boundary } = contentTypeOf(head);

    let text: string | null = null;
    if (type === "multipart/alternative" || type === "multipart/mixed") {
      if (boundary) {
        for (const part of partsOf(body, boundary)) {
          const pt = contentTypeOf(part.split(/\r?\n\r?\n/)[0] ?? part);
          if (pt.type === "text/plain") {
            const [phead, ...pbody] = part.split(/\r?\n\r?\n/);
            const pcte = phead.match(CTE_RE)?.[1]?.trim();
            text = decodeTransfer(pbody.join("\n\n"), pcte).trim();
            break;
          }
        }
        if (!text) {
          for (const part of partsOf(body, boundary)) {
            const pt = contentTypeOf(part.split(/\r?\n\r?\n/)[0] ?? part);
            if (pt.type === "text/html") {
              const [phead, ...pbody] = part.split(/\r?\n\r?\n/);
              const pcte = phead.match(CTE_RE)?.[1]?.trim();
              text = stripHtml(decodeTransfer(pbody.join("\n\n"), pcte));
              break;
            }
          }
        }
      }
    } else if (type === "text/html") {
      text = stripHtml(decodeTransfer(body, cte));
    } else {
      text = decodeTransfer(body, cte).trim();
    }

    if (!text) return null;
    return text.slice(0, MAX_EXTRACTED_CHARS);
  } catch (err) {
    console.error("[wt3:extract] .eml parse failed", err);
    return null;
  }
}

/**
 * Deterministic text extraction for an upload. `decoded.decodedText` is already
 * populated for text-ish types by lib/upload.ts; this dispatches binary types.
 */
export async function extractDocumentText(decoded: {
  bytes: Buffer;
  decodedText: string | null;
  contentType: string;
  filename: string;
}): Promise<ExtractedText | null> {
  const { contentType } = decoded;
  if (contentType === "application/pdf") return extractPdfText(decoded.bytes);
  if (contentType === "message/rfc822" || contentType === "text/x-rfc822-headers") {
    const text = parseEml(decoded.bytes);
    return text ? { text, method: "eml" } : null;
  }
  if (contentType === "image/png" || contentType === "image/jpeg" || contentType === "image/webp") {
    return ocrImage(decoded.bytes);
  }
  if (decoded.decodedText && decoded.decodedText.trim()) {
    return { text: decoded.decodedText.slice(0, MAX_EXTRACTED_CHARS), method: "raw" };
  }
  return null;
}