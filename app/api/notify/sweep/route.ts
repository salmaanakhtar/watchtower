import { NextResponse } from "next/server";
import { runSweep } from "@/lib/notify-sweep";

export const runtime = "nodejs";

/**
 * Manual deadline notification sweep (WT-6). Public endpoint — safe to call
 * from a VPS cron job or for dev testing; the sweep itself is idempotent.
 */
export async function GET() {
  const stats = await runSweep();
  return NextResponse.json({ ok: true, ...stats });
}
