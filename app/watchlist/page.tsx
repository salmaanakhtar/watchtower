import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { WatchlistView, type WatchlistItem } from "@/components/watchlist";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("wt_session")?.value ?? null;
  const userId = parseSessionToken(session);
  if (!userId) redirect("/?auth=required");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) redirect("/?auth=required");

  const watchItems = await db.watchItem.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
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
          document: { select: { submissionId: true } },
        },
      },
    },
  });

  // Human deadline labels from the legacy submission result (the deterministic
  // engine emits "October 14" style dates; WT-3 moves to ISO dates).
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

  const items: WatchlistItem[] = watchItems.map((w) => ({
    id: w.id,
    status: w.status as WatchlistItem["status"],
    userNote: w.userNote,
    deadlineLabel:
      (w.obligation.document?.submissionId
        ? deadlineBySubmission.get(w.obligation.document.submissionId) ?? null
        : null) ?? null,
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
  }));

  return <WatchlistView user={user} items={items} />;
}
