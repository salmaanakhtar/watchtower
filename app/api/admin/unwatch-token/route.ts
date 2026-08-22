import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnwatchToken } from "@/lib/notifications";

export const runtime = "nodejs";

const bodySchema = z.object({ watchItemId: z.string().min(1).max(100) });

/**
 * Dev/e2e helper (WT-6): mints a one-click unwatch URL for a watch item so
 * tests can exercise the full unwatch flow without waiting for a real
 * notification email. Never active in production (NOTIFY_STUB_SENDER=1).
 */
export async function POST(req: Request) {
  if (process.env.NOTIFY_STUB_SENDER !== "1") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "watchItemId is required" }, { status: 400 });
  }
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;
  const token = createUnwatchToken(parsed.data.watchItemId);
  return NextResponse.json({ url: `${origin}/api/unwatch/${token}` });
}
