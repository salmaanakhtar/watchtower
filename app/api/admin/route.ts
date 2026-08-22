import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminAuthorized } from "@/lib/admin";
import { decryptField } from "@/lib/crypto";
import { audit, requestIp } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!adminAuthorized(req)) {
    await audit({ actor: "admin", action: "admin_denied", ip: requestIp(req) });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await audit({ actor: "admin", action: "admin_authorized", ip: requestIp(req) });
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
  return NextResponse.json({
    submissions: submissions.map((s) => ({
      ...s,
      rawBytes: decryptField(s.rawBytes),
      dataUrl: decryptField(s.dataUrl),
    })),
    waitlist: waitlist.map((w) => ({ ...w, email: decryptField(w.email) })),
    summary,
  });
}
