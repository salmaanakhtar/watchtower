import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().min(1).max(100) });

// Idempotent fetch: re-renders after a refresh/back-forward (WT-2) can request
// the stored result by id without re-running the analysis.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let id: string;
  try {
    id = paramsSchema.parse(await ctx.params).id;
  } catch {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const submission = await db.submission.findUnique({ where: { id } });
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (submission.status === "queued") {
    return NextResponse.json({ id: submission.id, result: null, queued: true });
  }

  let result: unknown = null;
  if (submission.result) {
    try {
      result = JSON.parse(submission.result);
    } catch {
      result = null;
    }
  }
  if (result === null) {
    return NextResponse.json({ error: "No result available" }, { status: 404 });
  }

  return NextResponse.json({ id: submission.id, result, queued: false });
}
