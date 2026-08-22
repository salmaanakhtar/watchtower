import { NextResponse } from "next/server";
import { clearSessionCookie, parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

function sessionUser(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)wt_session=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Returns the current session's user, or 401. */
export async function GET(req: Request) {
  const userId = parseSessionToken(sessionUser(req));
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ user: { id: user.id, email: user.email } });
}

export async function POST() {
  return NextResponse.json({ ok: true, signedOut: false }, { status: 405 });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
