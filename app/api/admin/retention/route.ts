import { NextResponse } from "next/server";
import { runRetention } from "@/lib/retention";
import { audit, requestIp } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Manual retention sweep trigger (WT-8). Admin-only (same bearer as the admin
 * API), so an operator can force a purge without waiting for the daily
 * scheduler.
 */
export async function GET(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    await audit({ actor: "admin", action: "admin_denied", detail: "retention sweep unauthorized", ip: requestIp(req) });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stats = await runRetention();
  return NextResponse.json({ ok: true, ...stats });
}
