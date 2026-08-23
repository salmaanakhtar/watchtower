// WT-11: reputation webhook endpoint (bounces, complaints, failed, …).
//
// Resend sends these via the same Svix-signed transport. We record them so
// the forwarding domain's reputation can be monitored (lib/reputation.ts).

import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/inbound";
import { recordReputationEvent } from "@/lib/reputation";

export const runtime = "nodejs";

interface ReputationWebhookEvent {
  type?: string;
  data?: {
    email_id?: string;
    email?: string;
    bounce?: { bounce_type?: string; created_at?: string };
    created_at?: string;
    subject?: string;
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const valid = verifyWebhookSignature(
    rawBody,
    {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    process.env.RESEND_WEBHOOK_SECRET,
  );
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: ReputationWebhookEvent;
  try {
    event = JSON.parse(rawBody) as ReputationWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = event.type ?? "";
  const email = event.data?.email ?? null;
  const detail = event.data?.bounce?.bounce_type ?? null;

  let kind: "bounce" | "complaint" | "delivered" | "failed" | "suppressed" | null = null;
  if (type === "email.bounced") kind = "bounce";
  else if (type === "email.complained") kind = "complaint";
  else if (type === "email.delivered") kind = "delivered";
  else if (type === "email.failed") kind = "failed";
  else if (type === "email.suppressed") kind = "suppressed";

  if (kind) {
    await recordReputationEvent(kind, email, detail);
  }

  // Always acknowledge so Resend stops retrying.
  return NextResponse.json({ ok: true });
}
