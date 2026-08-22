import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  parseMagicToken,
  SESSION_TTL_MS,
} from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const paramsSchema = z.object({ token: z.string().min(10).max(500) });

function origin(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Magic-link verification (WT-5). Exchanges a valid token for a session cookie
 * and redirects to the watchlist (or back to the analysis if a pending
 * obligation id cookie is set).
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const base = origin(req);
  let token: string;
  try {
    token = paramsSchema.parse(await ctx.params).token;
  } catch {
    return NextResponse.redirect(`${base}/?auth=invalid`, 302);
  }

  const payload = parseMagicToken(token);
  if (!payload) {
    return NextResponse.redirect(`${base}/?auth=invalid`, 302);
  }

  const email = payload.email;
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    // Token is valid but the user row vanished (e.g. retention sweep).
    user = await db.user.create({ data: { email, anonymous: false } });
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const pendingMatch = cookieHeader.match(/(?:^|;\s*)wt_pending_obligation=([^;]+)/);
  const pending = pendingMatch?.[1] ? decodeURIComponent(pendingMatch[1]) : null;
  const target = pending
    ? `${base}/watch?obligation=${encodeURIComponent(pending)}`
    : `${base}/watchlist`;

  const res = NextResponse.redirect(target, 302);
  res.cookies.set("wt_session", createSessionToken(user.id), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  // If the user started from a "watch this" flow, clear the pending intent.
  if (pending) {
    res.cookies.set("wt_pending_obligation", "", { path: "/", maxAge: 0 });
  }

  return res;
}
