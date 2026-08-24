import { NextResponse } from "next/server";
import { parseSessionToken } from "@/lib/auth";
import { provisionAddress, rotateAddress, disableAddress } from "@/lib/forward-address";

export const runtime = "nodejs";

/**
 * Provision / rotate / disable the signed-in user's forwarding address (WT-12).
 */
export async function POST(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)wt_session=([^;]+)/);
  const sessionToken = match?.[1] ? decodeURIComponent(match[1]) : null;
  const userId = parseSessionToken(sessionToken);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let action = "provision";
  try {
    const body = (await req.json()) as { action?: string };
    action = body.action ?? "provision";
  } catch {
    action = "provision";
  }

  try {
    if (action === "rotate") {
      const { address } = await rotateAddress(userId);
      return NextResponse.json({ address, created: true }, { status: 201 });
    }
    if (action === "disable") {
      const disabled = await disableAddress(userId);
      return NextResponse.json({ address: null, disabled: Boolean(disabled) });
    }
    const { address, created } = await provisionAddress(userId);
    return NextResponse.json({ address, created }, { status: created ? 201 : 200 });
  } catch (err) {
    console.error("[wt12:forwarding] failed", err);
    return NextResponse.json({ error: "Failed to update forwarding address" }, { status: 500 });
  }
}
