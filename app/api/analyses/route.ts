import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeText } from "@/lib/analysis";
import { db } from "@/lib/db";
import { toCanonical } from "@/lib/obligations";
import { encryptField } from "@/lib/crypto";
import { ipRateExceeded } from "@/lib/rate-limit";
import {
  contentHash,
  decodeUpload,
  extractionPending,
  MAX_DECODED_CHARS,
  MAX_UPLOAD_BYTES,
} from "@/lib/upload";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    content: z.string().min(1, "content is required").max(50_000),
    variant: z.enum(["A", "B", "C", "D"]).default("A"),
    kind: z.enum(["paste", "file"]).default("paste"),
    contentType: z.string().optional(),
    filename: z.string().max(255).optional(),
    base64: z.string().max(MAX_UPLOAD_BYTES * 2 + 8).optional(),
    consent: z.boolean().optional().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.kind === "file" && (!val.base64 || !val.contentType)) {
      ctx.addIssue({
        code: "custom",
        message: "kind=file requires base64 and contentType",
        path: ["base64"],
      });
    }
  });

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

// Anonymous analyzer entrypoint (WT-2). Paste → analyze immediately.
// Uploads: text-ish types are decoded deterministically and analyzed;
// PDFs/images are acknowledged as queued (extraction lands in Phase 1).
export async function POST(req: Request) {
  // WT-8: anonymous per-IP quota (in-memory; resets on restart).
  if (ipRateExceeded(clientIp(req))) {
    return NextResponse.json(
      { error: "Too many analyses from this connection. Try again later." },
      { status: 429 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  // WT-8: consent is required before any document content is stored.
  if (parsed.data.consent !== true) {
    return NextResponse.json(
      { error: "You must accept the processing notice to analyze a document." },
      { status: 403 },
    );
  }

  const { content, variant, kind, contentType, filename } = parsed.data;
  const consentAt = new Date();

  if (kind === "file") {
    const decoded = decodeUpload(parsed.data.base64!, contentType!, filename ?? "upload.bin");
    if (!decoded) {
      return NextResponse.json(
        { error: "Unsupported file type or file too large (max 10MB)." },
        { status: 415 },
      );
    }
    if (extractionPending(decoded.contentType)) {
      // Acknowledge, don't fake a result: the submission goes to the manual
      // review queue (WT-9) and the admin sees the original file.
      const dataUrl = `data:${decoded.contentType};base64,${parsed.data.base64}`;
      const submission = await db.submission.create({
        data: {
          variant,
          kind: "queued",
          contentType: decoded.contentType,
          filename: decoded.filename,
          sizeBytes: decoded.bytes.length,
          contentHash: contentHash(decoded.filename + ":" + decoded.bytes.length),
          content: encryptField(`[File uploaded: ${decoded.filename} (${decoded.contentType})] Manual review in progress.`) ?? "",
          rawBytes: encryptField(parsed.data.base64) ?? null,
          dataUrl: encryptField(dataUrl) ?? null,
          consent: true,
          consentAt,
          status: "queued",
        },
      });
      return NextResponse.json({
        id: submission.id,
        result: null,
        queued: true,
        message:
          "PDF and image extraction is coming online in Phase 1. This document has been queued for manual review.",
      });
    }

    if (decoded.decodedText === null || !decoded.decodedText) {
      return NextResponse.json(
        { error: "No readable text found in this file." },
        { status: 422 },
      );
    }

    const result = analyzeText(decoded.decodedText.slice(0, MAX_DECODED_CHARS));
    const submission = await db.submission.create({
      data: {
        variant,
        kind,
        contentType: decoded.contentType,
        filename: decoded.filename,
        sizeBytes: decoded.bytes.length,
        contentHash: contentHash(decoded.decodedText),
        content: encryptField(decoded.decodedText.slice(0, MAX_DECODED_CHARS)) ?? "",
        consent: true,
        consentAt,
        status: "done",
        result: encryptField(JSON.stringify(result)) ?? null,
        analysis: encryptField(JSON.stringify({ title: result.title, exposure: result.exposureLabel })) ?? null,
      },
    });
    const canonical = await persistCanonical(submission.id, result, {
      source: "upload",
      filename: decoded.filename,
      contentType: decoded.contentType,
      extractedText: decoded.decodedText.slice(0, MAX_DECODED_CHARS),
      contentHash: contentHash(decoded.decodedText),
    });
    return NextResponse.json({ id: submission.id, result, queued: false, obligation: canonical });
  }

  const result = analyzeText(content);
  const submission = await db.submission.create({
    data: {
      variant,
      kind,
      contentType: contentType ?? "text/plain",
      contentHash: contentHash(content),
      content: encryptField(content) ?? "",
      consent: true,
      consentAt,
      status: "done",
      result: encryptField(JSON.stringify(result)) ?? null,
      analysis: encryptField(JSON.stringify({ title: result.title, exposure: result.exposureLabel })) ?? null,
    },
  });
  const canonical = await persistCanonical(submission.id, result, {
    source: "paste",
    filename: null,
    contentType: contentType ?? "text/plain",
    extractedText: content,
    contentHash: contentHash(content),
  });

  return NextResponse.json({ id: submission.id, result, queued: false, obligation: canonical });
}

// WT-4: persist the canonical obligation + provenance facts for a submission.
// Returns the created obligation id so clients can reference the durable row.
async function persistCanonical(
  submissionId: string,
  result: ReturnType<typeof analyzeText>,
  document: {
    source: string;
    filename: string | null;
    contentType: string | null;
    extractedText: string;
    contentHash: string | null;
  },
): Promise<{ id: string } | null> {
  try {
    const { obligation, facts } = toCanonical(result, {
      source: document.source,
      filename: document.filename,
      contentType: document.contentType,
      extractedText: document.extractedText,
      extractionMethod: document.source === "paste" ? "raw" : "raw",
      contentHash: document.contentHash,
    });

    const created = await db.document.create({
      data: {
        source: document.source,
        filename: document.filename,
        contentType: document.contentType,
        extractedText: encryptField(document.extractedText) ?? "",
        extractionMethod: "raw",
        contentHash: document.contentHash,
        submissionId,
        obligations: {
          create: {
            kind: obligation.kind,
            counterpartyName: obligation.counterpartyName,
            amountCents: obligation.amountCents,
            currency: obligation.currency ?? "USD",
            interval: obligation.interval,
            autoRenews: obligation.autoRenews,
            termsQuote: obligation.termsQuote,
            riskType: obligation.riskType,
            exposureLowCents: obligation.exposureLowCents,
            exposureHighCents: obligation.exposureHighCents,
            exposureAssumption: obligation.exposureAssumption,
            verification: obligation.verification,
            confidence: obligation.confidence,
            status: "open",
            facts: {
              create: facts.map((f) => ({
                label: f.label,
                value: f.value,
                quote: f.quote,
                offsetStart: f.offsetStart,
                offsetEnd: f.offsetEnd,
                confidence: f.confidence,
              })),
            },
          },
        },
      },
      select: { id: true, obligations: { select: { id: true } } },
    });

    const obligationId = created.obligations[0]?.id ?? null;
    return obligationId ? { id: obligationId } : null;
  } catch (err) {
    // Canonical persistence must never break the user-facing result. The
    // submission row is already saved; log and degrade to the legacy shape.
    console.error("[wt4] failed to persist canonical obligation", err);
    return null;
  }
}
