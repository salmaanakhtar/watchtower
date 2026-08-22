import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  parseMagicToken,
  SESSION_TTL_MS,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptField, hashForLookup } from "@/lib/crypto";
import { audit, requestIp } from "@/lib/audit";

export const runtime = "nodejs";

const paramsSchema = z.object({ token: z.string().min(10).max(500) });

/**
 * Magic-link verification (WT-5). Exchanges a valid token for a session cookie
 * and redirects to the watchlist (or back to the analysis if a pending
 * obligation id cookie is set). Uses a relative Location so the browser stays
 * on whatever origin it came from (cookies are origin-scoped).
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  let token: string;
  try {
    token = paramsSchema.parse(await ctx.params).token;
  } catch {
    await audit({ actor: "system", action: "auth_verify_failed", detail: "malformed token", ip: requestIp(req) });
    return redirectWith("/?auth=invalid");
  }

  const payload = parseMagicToken(token);
  if (!payload) {
    await audit({ actor: "system", action: "auth_verify_failed", detail: "invalid token", ip: requestIp(req) });
    return redirectWith("/?auth=invalid");
  }

  const email = payload.email;
  const emailHash = hashForLookup(email);
  let user = await db.user.findUnique({ where: { emailHash } });
  if (!user) {
    // Token is valid but the user row vanished (e.g. retention sweep).
    user = await db.user.create({ data: { emailHash, email: encryptField(email), anonymous: false } });
  }
  await audit({
    actor: `user:${user.id}`,
    action: "auth_verify_success",
    detail: `email:${emailHash}`,
    ip: requestIp(req),
  });

  const cookieHeader = req.headers.get("cookie") ?? "";
  const pendingMatch = cookieHeader.match(/(?:^|;\s*)wt_pending_obligation=([^;]+)/);
  const pending = pendingMatch?.[1] ? decodeURIComponent(pendingMatch[1]) : null;
  const target = pending
    ? `/watch?obligation=${encodeURIComponent(pending)}`
    : "/watchlist";

  const res = redirectWith(target);
  res.cookies.set("wt_session", createSessionToken(user.id), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_ORIGIN ?? "").startsWith("https://"),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  // If the user started from a "watch this" flow, clear the pending intent.
  if (pending) {
    res.cookies.set("wt_pending_obligation", "", { path: "/", maxAge: 0 });
  }

  return res;
}

function redirectWith(location: string): NextResponse {
  // NextResponse.redirect requires an absolute URL; we build a 302 to a
  // throwaway origin, then override Location with the relative path so the
  // browser stays on the origin it came from (cookies are origin-scoped).
  const res = NextResponse.redirect("http://localhost" + location, 302);
  res.headers.set("Location", location);
  return res;
}
