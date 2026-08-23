// Shared document ingestion (WT-4/WT-3, extended WT-11).
//
// One canonical path turns "some text + metadata" into durable rows:
// Submission (Phase 0 queue) → Document → Obligation → ProvenanceFact.
// Used by the anonymous analyzer (paste/upload) and by inbound email
// forwarding (WT-11). The deterministic analyzer drives the user-facing
// result; LLM structured extraction (when configured) enriches the durable
// rows with ISO dates + per-field confidence. Canonical persistence must
// never break the user-facing result — on failure it logs and returns null.

import { encryptField } from "@/lib/crypto";
import { analyzeText } from "@/lib/analysis";
import { structuredExtract } from "@/lib/llm-extract";
import { toCanonical, toCanonicalStructured } from "@/lib/obligations";
import { contentHash } from "@/lib/upload";
import { db } from "@/lib/db";

export const MAX_INGEST_CHARS = 50_000;

export interface IngestDocumentInput {
  source: string; // paste | upload | forward
  filename: string | null;
  contentType: string | null;
  extractedText: string;
  extractionMethod: string; // raw | pdf-parse | ocr | eml | llm
  contentHashValue: string | null;
}

export interface IngestOutput {
  submissionId: string;
  documentId: string;
  obligationId: string | null;
}

/**
 * Analyze text and persist the canonical rows (Submission + Document +
 * Obligation + ProvenanceFact) for it. Returns the created ids, or null when
 * canonical persistence failed (caller may still have the submission row).
 */
export async function ingestText(
  text: string,
  document: IngestDocumentInput,
): Promise<IngestOutput | null> {
  const content = text.slice(0, MAX_INGEST_CHARS);
  const result = analyzeText(content);

  const submission = await db.submission.create({
    data: {
      variant: "A",
      kind: "forward",
      contentType: document.contentType ?? "text/plain",
      filename: document.filename,
      contentHash: document.contentHashValue ?? contentHash(content),
      content: encryptField(content) ?? "",
      consent: true,
      consentAt: new Date(),
      status: "done",
      result: encryptField(JSON.stringify(result)) ?? null,
      analysis: encryptField(JSON.stringify({ title: result.title, exposure: result.exposureLabel })) ?? null,
    },
  });

  return persistCanonical(submission.id, result, document);
}

/**
 * Persist the canonical obligation + provenance rows for a submission.
 * Returns the created ids, or null on failure (never throws to the caller).
 */
export async function persistCanonical(
  submissionId: string,
  result: ReturnType<typeof analyzeText>,
  document: IngestDocumentInput,
): Promise<IngestOutput | null> {
  try {
    // WT-3: optional LLM structured extraction (env-gated, schema-validated,
    // never throws). On success we map its ISO dates + confidence into the
    // canonical rows; on any failure we fall back to the deterministic mapper.
    const structured = await structuredExtract(document.extractedText.slice(0, 20_000));
    const { obligation, facts } = structured
      ? toCanonicalStructured(structured, {
          source: document.source,
          filename: document.filename,
          contentType: document.contentType,
          extractedText: document.extractedText,
          extractionMethod: "llm",
          contentHash: document.contentHashValue,
        })
      : toCanonical(result, {
          source: document.source,
          filename: document.filename,
          contentType: document.contentType,
          extractedText: document.extractedText,
          extractionMethod: document.extractionMethod,
          contentHash: document.contentHashValue,
        });

    const extractionMethod = structured ? "llm" : document.extractionMethod;
    const created = await db.document.create({
      data: {
        source: document.source,
        filename: document.filename,
        contentType: document.contentType,
        extractedText: encryptField(document.extractedText.slice(0, MAX_INGEST_CHARS)) ?? "",
        extractionMethod,
        contentHash: document.contentHashValue,
        submissionId,
        obligations: {
          create: {
            kind: obligation.kind,
            counterpartyName: obligation.counterpartyName,
            amountCents: obligation.amountCents,
            currency: obligation.currency ?? "USD",
            interval: obligation.interval,
            amountConfidence: null,
            startDate: obligation.startDate ? new Date(obligation.startDate) : null,
            renewalDate: obligation.renewalDate ? new Date(obligation.renewalDate) : null,
            noticeDeadlineDate: obligation.noticeDeadlineDate ? new Date(obligation.noticeDeadlineDate) : null,
            expiryDate: obligation.expiryDate ? new Date(obligation.expiryDate) : null,
            cancellationNoticeDays: obligation.cancellationNoticeDays,
            autoRenews: obligation.autoRenews,
            termsQuote: obligation.termsQuote,
            riskType: obligation.riskType,
            exposureLowCents: obligation.exposureLowCents,
            exposureHighCents: obligation.exposureHighCents,
            exposureAssumption: obligation.exposureAssumption,
            dueDate: obligation.dueDate ? new Date(obligation.dueDate) : null,
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
    return { submissionId, documentId: created.id, obligationId };
  } catch (err) {
    // Canonical persistence must never break the user-facing result. The
    // submission row is already saved; log and degrade to the legacy shape.
    console.error("[wt4] failed to persist canonical obligation", err);
    return null;
  }
}
