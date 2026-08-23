// WT-11: inbound email webhook endpoint.
//
// Resend delivers `email.received` events here (Svix-signed). The event only
// carries metadata; the full body/attachments are fetched from the Resend
// Received Emails API inside processInboundWebhook. We must ALWAYS return a
// 2xx as fast as possible so Resend doesn't retry spam — the heavy work is
// synchronous but bounded (10MB caps, 30s timeouts).

import { NextResponse } from "next/server";
import { processInboundWebhook, verifyWebhookSignature, type InboundWebhookEvent } from "@/lib/inbound";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Read the raw body for signature verification (never re-stringify).
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

  let event: InboundWebhookEvent;
  try {
    event = JSON.parse(rawBody) as InboundWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only inbound email events are relevant; ignore everything else.
  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  try {
    const result = await processInboundWebhook(event);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[wt11:inbound] webhook processing failed", err);
    // Acknowledge anyway so Resend doesn't retry a poison message forever;
    // the failure is captured in the InboundMessage row (status=failed).
    return NextResponse.json({ ok: true, error: "processing_failed" });
  }
}
