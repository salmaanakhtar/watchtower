import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminAuthorized } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [submissions, waitlist, summary] = await Promise.all([
    db.submission.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        variant: true,
        kind: true,
        contentType: true,
        filename: true,
        sizeBytes: true,
        status: true,
        category: true,
        analysis: true,
        createdAt: true,
        rawBytes: true,
        dataUrl: true,
      },
    }),
    db.waitlist.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.submission.groupBy({
      by: ["category"],
      _count: { _all: true },
      where: { category: { not: null } },
    }),
  ]);
  return NextResponse.json({ submissions, waitlist, summary });
}
