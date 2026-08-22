import { NextResponse } from "next/server";
import { z } from "zod";
import { createMagicToken } from "@/lib/auth";
import { db } from "@/lib/db";
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
  const token = createMagicToken(email);

  // Ensure the user row exists (upsert by email) so /auth/verify can link
  // anonymous analyses to the same account later.
  await db.user.upsert({
    where: { email },
    update: { anonymous: false },
    create: { email, anonymous: false },
  });

  // Rate-limit: at most one magic link per email per minute (WT-8 hardening
  // will replace this with a durable limiter).
  const cooldownMs = 60_000;
  const last = await db.event.findFirst({
    where: { type: "magic_requested" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && Date.now() - last.createdAt.getTime() < cooldownMs) {
    return NextResponse.json(
      { error: "A sign-in link was already sent recently. Check your inbox." },
      { status: 429 },
    );
  }

  if (isProdEmailEnabled()) {
    const result = await sendEmail(magicLinkEmail(email, token));
    // Rate-limit bookkeeping (best-effort, never breaks the flow).
    await db.event
      .create({ data: { type: "magic_requested", detail: email } })
      .catch(() => {});
    return NextResponse.json(
      { ok: true, delivered: result.delivered },
      { status: result.delivered ? 201 : 502 },
    );
  }

  // e2e stub (NOTIFY_STUB_SENDER=1, dev only): deliver the "email" to the
  // in-memory stub AND keep the dev link so the UI flow is unchanged.
  if (process.env.NOTIFY_STUB_SENDER === "1") {
    await sendEmail(magicLinkEmail(email, token));
    return NextResponse.json({ ok: true, delivered: true, token }, { status: 201 });
  }

  // Dev-only: return the link so the flow completes without an email server.
  return NextResponse.json({ ok: true, delivered: true, token }, { status: 201 });
}
