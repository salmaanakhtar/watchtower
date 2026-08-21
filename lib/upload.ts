// File intake for the anonymous analyzer (WT-2).
// Phase 1 keeps this deterministic: decode safe file types into text client-side,
// upload base64, validate server-side, hash for dedupe, never store raw bytes.

import { createHash } from "node:crypto";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB (matches the UI dropzone)
export const MAX_DECODED_CHARS = 50_000; // same cap as pasted text

export interface DecodedUpload {
  bytes: Buffer;
  decodedText: string | null;
  contentType: string;
  filename: string;
}

const ALLOWED_MIME = new Set([
  "text/plain",
  "application/json",
  "text/html",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const KNOWN_UNSUPPORTED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function uploadSupported(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

// PDFs/images are queued for extraction (Phase 1): we acknowledge them so the
// anonymous user sees an honest "manual review" state instead of a fake result.
export function extractionPending(mime: string): boolean {
  return KNOWN_UNSUPPORTED.has(mime);
}

function mimeFor(mime: string, bytes: Buffer): string {
  const trimmed = mime.split(";")[0].trim().toLowerCase();
  if (ALLOWED_MIME.has(trimmed)) return trimmed;
  // Fall back to magic bytes for common formats so spoofed MIME types don't
  // bypass the allowlist or the queued-extraction path.
  if (bytes.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) return "application/pdf";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  return "application/octet-stream";
}

// Deterministic decode for text-ish types. Binary formats (PDF/images) return
// null decodedText — the pipeline marks them queued, never analyzes noise.
export function decodeUpload(
  base64: string,
  rawMime: string,
  filename: string,
): DecodedUpload | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) return null;

  const contentType = mimeFor(rawMime, bytes);
  if (contentType === "application/octet-stream") return null;

  let decodedText: string | null = null;
  if (contentType === "text/plain" || contentType === "application/json") {
    decodedText = bytes.subarray(0, MAX_DECODED_CHARS).toString("utf8");
  } else if (contentType === "text/html") {
    decodedText = bytes
      .subarray(0, MAX_DECODED_CHARS)
      .toString("utf8")
      .replace(/<[^>]*>/g, " ")
      .replace(/<|>/g, "")
      .replace(/\s+([/.,;:!?%])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (decodedText !== null) decodedText = decodedText.trim();

  return { bytes, decodedText, contentType, filename };
}

export function contentHash(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
