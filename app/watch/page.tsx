import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { WatchConfirmation } from "@/components/watch-confirmation";

export const dynamic = "force-dynamic";

/**
 * Post-sign-in landing for the watch flow (WT-5). The magic-link redirect
 * arrives here with ?obligation=<id>; this page links the obligation to the
 * fresh account (if not already) and confirms the watch is active.
 */
export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ obligation?: string }>;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get("wt_session")?.value ?? null;
  const userId = parseSessionToken(session);
  if (!userId) redirect("/?auth=required");

  const { obligation: obligationId } = await searchParams;
  if (!obligationId) redirect("/watchlist");

  const obligation = await db.obligation.findUnique({
    where: { id: obligationId },
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
    },
  });
  if (!obligation) redirect("/watchlist");

  const watchItem = await db.watchItem.upsert({
    where: { userId_obligationId: { userId, obligationId } },
    update: { status: "open" },
    create: { userId, obligationId, status: "open" },
  });

  // Log the lifecycle event once.
  const existing = await db.event.count({
    where: { userId, obligationId, type: "watched" },
  });
  if (existing === 0) {
    await db.event.create({ data: { userId, obligationId, type: "watched" } });
  }

  return <WatchConfirmation watchItemId={watchItem.id} obligation={obligation} />;
}
