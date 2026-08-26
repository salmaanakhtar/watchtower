import { NextResponse } from "next/server";
import { z } from "zod";
import { parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { initialStatusFromDeadline } from "@/lib/notify-sweep";
import { contextFromRequest, recordExperimentEvent, sessionIdFromRequest } from "@/lib/experiments";

export const runtime = "nodejs";

const bodySchema = z.object({
  obligationId: z.string().min(1).max(100),
});

/**
 * Watch an obligation (WT-5). Creates a WatchItem for the authenticated user,
 * or for an anonymous session (email not required yet). Returns the watch item
 * and a flag telling the client whether an account is needed to persist.
 */
export async function POST(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)wt_session=([^;]+)/);
  const sessionToken = match?.[1] ? decodeURIComponent(match[1]) : null;
  const userId = parseSessionToken(sessionToken);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "obligationId is required" }, { status: 400 });
  }

  const obligation = await db.obligation.findUnique({
    where: { id: parsed.data.obligationId },
    select: { id: true, userId: true, kind: true, counterpartyName: true, dueDate: true, renewalDate: true },
  });
  if (!obligation) {
    return NextResponse.json({ error: "Obligation not found" }, { status: 404 });
  }

  if (!userId) {
    // Anonymous: remember the intent via cookie so a later sign-in links it.
    const res = NextResponse.json(
      { watchItem: null, needsAccount: true, obligationId: obligation.id },
      { status: 201 },
    );
    res.headers.append(
      "Set-Cookie",
      `wt_pending_obligation=${encodeURIComponent(obligation.id)}; Path=/; SameSite=Lax; Max-Age=3600`,
    );
    return res;
  }

  // WT-14: start the lifecycle in the right state (deadline already past /
  // inside the notify window) instead of defaulting to "open".
  const initialStatus = initialStatusFromDeadline(obligation.dueDate ?? obligation.renewalDate);
  const watchItem = await db.watchItem.upsert({
    where: { userId_obligationId: { userId, obligationId: obligation.id } },
    update: { status: initialStatus },
    create: { userId, obligationId: obligation.id, status: initialStatus },
  });

  // WT-15: the first watch of a session is the account-conversion funnel step.
  const sessionId = sessionIdFromRequest(req);
  if (sessionId) {
    const already = await db.experimentEvent.count({
      where: { sessionId, event: "account_created" },
    });
    if (already === 0) {
      void recordExperimentEvent(
        "account_created",
        contextFromRequest(req, null, null),
        null,
        sessionId,
      );
    }
  }

  return NextResponse.json({ watchItem, needsAccount: false }, { status: 201 });
}
