import { NextResponse } from "next/server";
import { parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLedgerSummary, recordLedgerEntry, ledgerEntryInputSchema } from "@/lib/ledger";

export const runtime = "nodejs";

function sessionUserId(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)wt_session=([^;]+)/);
  const sessionToken = match?.[1] ? decodeURIComponent(match[1]) : null;
  return parseSessionToken(sessionToken);
}

/**
 * The signed-in user's money-protected ledger (WT-13). Returns a summary
 * (total + per-category, strict definitions) and every entry linked to its
 * source obligation for drill-down.
 */
export async function GET(req: Request) {
  const userId = sessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const summary = await getLedgerSummary(userId);
  return NextResponse.json({ ledger: summary });
}

/**
 * Record a ledger entry (WT-13): prevented / recovered / avoided. The user
 * must own the obligation; entries are idempotent per (user, obligation,
 * category). Recovered entries require an explicit amount the user actually
 * got back — it is never derived from the obligation.
 */
export async function POST(req: Request) {
  const userId = sessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ledgerEntryInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Valid obligationId, category, and positive amountCents are required" },
      { status: 400 },
    );
  }

  const obligation = await db.obligation.findFirst({
    where: { id: parsed.data.obligationId, OR: [{ userId }, { watchItems: { some: { userId } } }] },
    select: { id: true },
  });
  if (!obligation) {
    return NextResponse.json({ error: "Obligation not found" }, { status: 404 });
  }

  const { entry, created } = await recordLedgerEntry(userId, parsed.data);
  return NextResponse.json({ entry, created }, { status: created ? 201 : 200 });
}
