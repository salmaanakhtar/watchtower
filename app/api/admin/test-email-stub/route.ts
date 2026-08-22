import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Dev/e2e stub email capture (WT-6). Not a real deliverable: lets the e2e
 * suite verify the magic-link and notification emails without a provider.
 * Behind NOTIFY_STUB_SENDER=1 and never active in production builds.
 */
export async function GET() {
  if (process.env.NOTIFY_STUB_SENDER !== "1") {
    return NextResponse.json({ enabled: false, emails: [] }, { status: 404 });
  }
  return NextResponse.json({ enabled: true, emails: globalThis.__wtStubEmails ?? [] });
}

export async function POST(req: Request) {
  if (process.env.NOTIFY_STUB_SENDER !== "1") {
    return NextResponse.json({ enabled: false, emails: [] }, { status: 404 });
  }
  let body: { enabled?: boolean } = {};
  try {
    body = await req.json();
  } catch {}
  if (body.enabled === false) globalThis.__wtStubEmails = [];
  return NextResponse.json({ enabled: true, emails: globalThis.__wtStubEmails ?? [] });
}

declare global {
  var __wtStubEmails: { to: string; subject: string; text: string; html: string }[] | null;
}
