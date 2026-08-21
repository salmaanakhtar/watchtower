import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminAuthorized } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const submissions = await db.submission.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const waitlist = await db.waitlist.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json({ submissions, waitlist });
}
