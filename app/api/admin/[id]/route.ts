import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminAuthorized } from "@/lib/admin";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({ analysis: z.string().max(10_000).optional() });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = paramsSchema.parse(await ctx.params);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const updated = await db.submission.update({
    where: { id },
    data: { analysis: parsed.data.analysis ?? null },
  });
  return NextResponse.json({ updated });
}
