import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminAuthorized } from "@/lib/admin";
import { audit, requestIp } from "@/lib/audit";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({
  analysis: z.string().max(10_000).optional(),
  category: z
    .enum(["subscription", "bill", "contract", "receipt", "refund", "notice", "other"])
    .optional(),
  status: z.enum(["queued", "done", "reviewed"]).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!adminAuthorized(req)) {
    await audit({ actor: "admin", action: "admin_denied", ip: requestIp(req) });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = paramsSchema.parse(await ctx.params);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const data: { analysis?: string | null; category?: string; status?: string } = {};
  if (parsed.data.analysis !== undefined) data.analysis = parsed.data.analysis ?? null;
  if (parsed.data.category !== undefined) data.category = parsed.data.category;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  const updated = await db.submission.update({
    where: { id },
    data,
  });
  await audit({
    actor: "admin",
    action: "admin_review",
    target: id,
    detail: `status=${updated.status} category=${updated.category ?? "none"}`,
    ip: requestIp(req),
  });
  return NextResponse.json({ updated });
}
