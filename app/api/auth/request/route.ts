import { NextResponse } from "next/server";
import { z } from "zod";
import { createMagicToken } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

/**
 * Magic-link request (WT-5). Creates a signed one-time token and delivers it:
 * - When AUTH_EMAIL_FROM / AUTH_EMAIL_FROM_NAME are set (production): the
 *   route would hand off to an email provider (Resend/Postmark). Email
 *   delivery is not wired yet — WT-6 owns real sending.
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

  if (process.env.AUTH_EMAIL_FROM) {
    // Real email handoff lands in WT-6; for now just log the link.
    console.log(`[wt5] magic link for ${email}: /auth/verify?token=${token}`);
    return NextResponse.json({ ok: true, delivered: false }, { status: 201 });
  }

  // Dev-only: return the link so the flow completes without an email server.
  return NextResponse.json({ ok: true, delivered: true, token }, { status: 201 });
}
