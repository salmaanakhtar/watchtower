import { NextResponse } from "next/server";
import { z } from "zod";
import { parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordPreventedFromObligation } from "@/lib/ledger";
import { initialStatusFromDeadline } from "@/lib/notify-sweep";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().min(1).max(100) });

const bodySchema = z
  .object({
    status: z.enum(["open", "upcoming", "due", "resolved", "dismissed"]).optional(),
    note: z.string().max(500).optional().nullable(),
  })
  .refine((v) => v.status !== undefined || v.note !== undefined, {
    message: "Provide status or note",
  });

/**
 * Update a watch item (WT-5): resolve, dismiss, or add a note. The watch item
 * must belong to the authenticated user.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let id: string;
  try {
    id = paramsSchema.parse(await ctx.params).id;
  } catch {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)wt_session=([^;]+)/);
  const sessionToken = match?.[1] ? decodeURIComponent(match[1]) : null;
  const userId = parseSessionToken(sessionToken);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide status or note" }, { status: 400 });
  }

  const watchItem = await db.watchItem.findFirst({
    where: { id, userId },
  });
  if (!watchItem) {
    return NextResponse.json({ error: "Watch item not found" }, { status: 404 });
  }

  const data: { status?: string; userNote?: string | null } = {};
  if (parsed.data.status) data.status = parsed.data.status;
  if (parsed.data.note !== undefined) data.userNote = parsed.data.note ?? null;

  // WT-14: reopening a resolved/dismissed item recomputes the lifecycle state
  // from its deadline instead of leaving it stuck in a terminal state.
  if (parsed.data.status === "open" && ["resolved", "dismissed"].includes(watchItem.status)) {
    const obligation = await db.obligation.findUnique({
      where: { id: watchItem.obligationId },
      select: { dueDate: true, renewalDate: true },
    });
    data.status = initialStatusFromDeadline(obligation?.dueDate ?? obligation?.renewalDate ?? null);
  }

  const updated = await db.watchItem.update({
    where: { id: watchItem.id },
    data,
    select: {
      id: true,
      status: true,
      userNote: true,
      obligationId: true,
      userId: true,
    },
  });

  // Log the lifecycle event (append-only, feeds Phase 8 verification).
  await db.event.create({
    data: {
      userId,
      obligationId: updated.obligationId,
      type: updated.status === "resolved" ? "resolved" : updated.status === "dismissed" ? "dismissed" : "updated",
      detail: parsed.data.note ?? null,
    },
  });

  // WT-13: resolving an obligation records a "prevented" ledger entry
  // (projected cost avoided). Idempotent — no double counting. The response
  // carries it so the UI can show "Money protected" on resolve.
  let ledgerEntry = null;
  let ledgerCreated = false;
  if (updated.status === "resolved") {
    const result = await recordPreventedFromObligation(
      userId,
      updated.obligationId,
      parsed.data.note ?? "Marked resolved — projected cost avoided.",
    );
    ledgerEntry = result.entry;
    ledgerCreated = result.created;
  }

  return NextResponse.json({ watchItem: updated, ledgerEntry, ledgerCreated });
}
