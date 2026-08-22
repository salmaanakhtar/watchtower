// WT-8: retention sweeps.
//
// Rules (Phase 1 baseline — no raw bytes stored, so retention is mostly about
// minimizing the persisted PII surface):
//   - Anonymous submissions with no consent, or queued binary uploads past the
//     review window, are deleted entirely (submission + its canonical rows when
//     nothing references them).
//   - Submissions older than RETENTION_DAYS with no linked watch items have
//     their full text removed (content + analysis + result + rawBytes/dataUrl),
//     leaving only metadata (status/category/counters).
//   - Fully anonymous (no user) canonical documents + obligations are deleted
//     once nothing references them and the submission is gone.
// Rows referenced by an active watch item are always kept.

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);
export const QUEUE_REVIEW_WINDOW_DAYS = Number(process.env.QUEUE_REVIEW_WINDOW_DAYS ?? 30);

export interface RetentionStats {
  deletedSubmissions: number;
  anonymizedSubmissions: number;
  deletedDocuments: number;
}

/** Delete submissions that should never have been kept (no consent / stale queued uploads). */
async function deleteUnconsentedAndStaleQueued(now: Date): Promise<number> {
  const staleQueueCutoff = new Date(now.getTime() - QUEUE_REVIEW_WINDOW_DAYS * 86_400_000);
  const unconsented = await db.submission.findMany({
    where: { consent: false },
    select: { id: true, createdAt: true, status: true, kind: true },
  });
  const staleQueued = await db.submission.findMany({
    where: {
      kind: "queued",
      status: { in: ["queued", "received"] },
      createdAt: { lt: staleQueueCutoff },
    },
    select: { id: true },
  });
  const ids = new Set([
    ...unconsented.filter((s) => s.createdAt < now).map((s) => s.id),
    ...staleQueued.map((s) => s.id),
  ]);
  for (const id of ids) {
    await deleteSubmissionTree(id);
  }
  return ids.size;
}

/** Null out document text + legacy result payloads for old, unreferenced submissions. */
async function anonymizeOldSubmissions(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const old = await db.submission.findMany({
    where: {
      createdAt: { lt: cutoff },
      status: { not: "queued" },
    },
    select: { id: true },
  });
  let anonymized = 0;
  for (const { id } of old) {
    const watchRefs = await db.document.findFirst({
      where: {
        submissionId: id,
        obligations: { some: { watchItems: { some: { status: { not: "dismissed" } } } } },
      },
      select: { id: true },
    });
    if (watchRefs) continue; // still being watched — keep everything
    await db.submission.update({
      where: { id },
      data: { content: "", analysis: null, result: null, rawBytes: null, dataUrl: null },
    });
    // Canonical document text can go too — no active watches reference it.
    await db.document.updateMany({
      where: { submissionId: id },
      data: { extractedText: "" },
    });
    anonymized += 1;
  }
  return anonymized;
}

/** Delete a submission and its canonical tree when nothing else references it. */
async function deleteSubmissionTree(submissionId: string): Promise<void> {
  const docs = await db.document.findMany({
    where: { submissionId },
    select: { id: true },
  });
  for (const doc of docs) {
    const referenced = await db.watchItem.count({
      where: { obligation: { documentId: doc.id } },
    });
    if (referenced > 0) continue; // keep canonical rows while watched
    await db.provenanceFact.deleteMany({ where: { documentId: doc.id } });
    await db.event.deleteMany({ where: { obligation: { documentId: doc.id } } });
    await db.watchItem.deleteMany({ where: { obligation: { documentId: doc.id } } });
    await db.deadline.deleteMany({ where: { obligation: { documentId: doc.id } } });
    await db.payment.deleteMany({ where: { obligation: { documentId: doc.id } } });
    await db.obligation.deleteMany({ where: { documentId: doc.id } });
    await db.document.delete({ where: { id: doc.id } });
  }
  await db.submission.delete({ where: { id: submissionId } });
}

/** Run all retention sweeps. Returns stats for the audit log. */
export async function runRetention(now: Date = new Date()): Promise<RetentionStats> {
  const deletedSubmissions = await deleteUnconsentedAndStaleQueued(now);
  const anonymizedSubmissions = await anonymizeOldSubmissions(now);
  // Orphan canonical docs (no submission link and no watches) — tidy-up.
  const orphanDocs = await db.document.findMany({
    where: { submissionId: null, obligations: { none: { watchItems: { some: { status: { not: "dismissed" } } } } } },
    select: { id: true },
  });
  for (const doc of orphanDocs) {
    await db.provenanceFact.deleteMany({ where: { documentId: doc.id } });
    await db.obligation.deleteMany({ where: { documentId: doc.id } });
    await db.document.delete({ where: { id: doc.id } });
  }
  const stats = { deletedSubmissions, anonymizedSubmissions, deletedDocuments: orphanDocs.length };
  await audit({
    actor: "system",
    action: "retention_sweep",
    detail: JSON.stringify(stats),
  });
  return stats;
}
