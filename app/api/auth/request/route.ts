import { NextResponse } from "next/server";
import { z } from "zod";
import { createMagicToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptField, hashForLookup } from "@/lib/crypto";
import { audit, requestIp } from "@/lib/audit";
import {
  magicLinkOnCooldown,
  magicLinkRateExceeded,
  recordMagicLink,
} from "@/lib/rate-limit";
import { isProdEmailEnabled, magicLinkEmail, sendEmail } from "@/lib/notifications";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

/**
 * Magic-link request (WT-5/WT-6). Creates a signed one-time token and delivers
 * it:
 * - When RESEND_API_KEY + EMAIL_FROM are set (production): sends a real
 *   transactional email via the provider and returns delivered:true.
 * - Otherwise (dev): returns the magic link in the response body so local and
 *   e2e flows work without an SMTP server. Never enables this in production.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid email" },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const emailHash = hashForLookup(email);
  const token = createMagicToken(email);

  // Ensure the user row exists (upsert by email hash — the stored email is
  // encrypted at rest, so lookups go through the deterministic hash).
  await db.user.upsert({
    where: { emailHash },
    update: { anonymous: false, email: encryptField(email) },
    create: { emailHash, email: encryptField(email), anonymous: false },
  });

  // WT-8 rate limiting: at most one magic link per email per minute, and a
  // hard hourly cap. Keyed by email hash, not the plaintext.
  if (await magicLinkOnCooldown(email)) {
    return NextResponse.json(
      { error: "A sign-in link was already sent recently. Check your inbox." },
      { status: 429 },
    );
  }
  if (await magicLinkRateExceeded(email)) {
    await audit({
      actor: `email:${emailHash}`,
      action: "auth_request",
      detail: "hourly cap exceeded",
      ip: requestIp(req),
    });
    return NextResponse.json(
      { error: "Too many sign-in attempts for this email. Try again later." },
      { status: 429 },
    );
  }

  if (isProdEmailEnabled()) {
    const result = await sendEmail(magicLinkEmail(email, token));
    // Rate-limit bookkeeping (best-effort, never breaks the flow).
    await recordMagicLink(email);
    return NextResponse.json(
      { ok: true, delivered: result.delivered },
      { status: result.delivered ? 201 : 502 },
    );
  }

  // e2e stub (NOTIFY_STUB_SENDER=1, dev only): deliver the "email" to the
  // in-memory stub AND keep the dev link so the UI flow is unchanged.
  if (process.env.NOTIFY_STUB_SENDER === "1") {
    await sendEmail(magicLinkEmail(email, token));
    await recordMagicLink(email);
    return NextResponse.json({ ok: true, delivered: true, token }, { status: 201 });
  }

  // Dev-only: return the link so the flow completes without an email server.
  await recordMagicLink(email);
  return NextResponse.json({ ok: true, delivered: true, token }, { status: 201 });
}
