import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { encryptField } from "@/lib/crypto";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email("Enter a valid email address"),
  source: z.string().max(40).default("landing"),
});

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
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  try {
    await db.waitlist.create({ data: { email: encryptField(email) ?? "", source: parsed.data.source } });
  } catch {
    // unique constraint — treat as success (already on list)
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
