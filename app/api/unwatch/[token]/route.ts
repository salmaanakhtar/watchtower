import { NextResponse } from "next/server";
import { z } from "zod";
import { parseUnwatchToken } from "@/lib/notifications";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const paramsSchema = z.object({ token: z.string().min(10).max(500) });

/**
 * One-click "stop watching this" (WT-6). Validates the signed unwatch token
 * from the email footer, dismisses the watch item, and shows a confirmation
 * page. A page (not a redirect) so the mail client gets a clean 200 and the
 * user sees the result.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  let token: string;
  try {
    token = paramsSchema.parse(await ctx.params).token;
  } catch {
    return html("Invalid link", "This unsubscribe link is invalid. It may have expired.");
  }

  const watchItemId = parseUnwatchToken(token);
  if (!watchItemId) {
    return html("Invalid link", "This unsubscribe link is invalid. It may have expired.");
  }

  const watchItem = await db.watchItem.findUnique({ where: { id: watchItemId } });
  if (!watchItem) {
    return html("Already stopped", "This item is no longer being watched.");
  }

  await db.watchItem.update({
    where: { id: watchItemId },
    data: { status: "dismissed" },
  });
  await db.event.create({
    data: {
      userId: watchItem.userId,
      obligationId: watchItem.obligationId,
      type: "dismissed",
      detail: "one-click unsubscribe",
    },
  });

  return html(
    "Stopped watching",
    "You won't get reminders about this item anymore. Your other watch items are unchanged.",
  );
}

function html(title: string, message: string): NextResponse {
  const body = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#faf8f3;color:#1c1c1c;padding:48px 16px"><div style="max-width:420px;margin:0 auto;background:#ffffff;border:1px solid #e5e0d4;border-radius:12px;padding:28px"><h1 style="font-size:18px;margin:0 0 8px">${title}</h1><p style="font-size:14px;line-height:1.5;margin:0;color:#55524c">${message}</p></div></body></html>`;
  return new NextResponse(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
