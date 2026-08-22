import { NextResponse } from "next/server";
import { parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * The authenticated user's watchlist (WT-5). Returns watch items joined with
 * their obligation + document, plus the human-readable deadline from the
 * legacy submission result (the deterministic engine emits "October 14" style
 * dates; WT-3 will move to ISO dates on Obligation.dueDate).
 */
export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)wt_session=([^;]+)/);
  const sessionToken = match?.[1] ? decodeURIComponent(match[1]) : null;
  const userId = parseSessionToken(sessionToken);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const watchItems = await db.watchItem.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      deadline: true,
      userNote: true,
      obligation: {
        select: {
          id: true,
          kind: true,
          counterpartyName: true,
          amountCents: true,
          currency: true,
          interval: true,
          riskType: true,
          exposureLowCents: true,
          exposureHighCents: true,
          exposureAssumption: true,
          verification: true,
          confidence: true,
          dueDate: true,
          document: { select: { submissionId: true } },
        },
      },
    },
  });

  // Human deadline labels: pull from the legacy submission result when present.
  const submissionIds = watchItems
    .map((w) => w.obligation.document?.submissionId)
    .filter((s): s is string => Boolean(s));
  const submissions = submissionIds.length
    ? await db.submission.findMany({
        where: { id: { in: submissionIds } },
        select: { id: true, result: true },
      })
    : [];
  const deadlineBySubmission = new Map<string, string | null>();
  for (const s of submissions) {
    let deadline: string | null = null;
    if (s.result) {
      try {
        const parsed = JSON.parse(s.result) as { deadline?: string | null };
        deadline = parsed.deadline ?? null;
      } catch {
        deadline = null;
      }
    }
    deadlineBySubmission.set(s.id, deadline);
  }

  return NextResponse.json({
    watchItems: watchItems.map((w) => ({
      id: w.id,
      status: w.status,
      deadline: w.obligation.dueDate?.toISOString() ?? null,
      deadlineLabel:
        w.obligation.dueDate?.toISOString() ??
        (w.obligation.document?.submissionId
          ? deadlineBySubmission.get(w.obligation.document.submissionId) ?? null
          : null),
      userNote: w.userNote,
      obligation: {
        id: w.obligation.id,
        kind: w.obligation.kind,
        counterpartyName: w.obligation.counterpartyName,
        amountCents: w.obligation.amountCents,
        currency: w.obligation.currency,
        interval: w.obligation.interval,
        riskType: w.obligation.riskType,
        exposureLowCents: w.obligation.exposureLowCents,
        exposureHighCents: w.obligation.exposureHighCents,
        exposureAssumption: w.obligation.exposureAssumption,
        verification: w.obligation.verification,
        confidence: w.obligation.confidence,
      },
    })),
  });
}
