import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeText } from "@/lib/analysis";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  content: z.string().min(1, "content is required").max(50_000),
  variant: z.enum(["A", "B", "C", "D"]).default("A"),
  kind: z.enum(["paste", "file"]).default("paste"),
  contentType: z.string().optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const { content, variant, kind, contentType } = parsed.data;

  const result = analyzeText(content);
  const submission = await db.submission.create({
    data: {
      variant,
      kind,
      contentType,
      content,
      status: "done",
      analysis: JSON.stringify({ title: result.title, exposure: result.exposureLabel }),
    },
  });

  return NextResponse.json({ id: submission.id, result });
}
