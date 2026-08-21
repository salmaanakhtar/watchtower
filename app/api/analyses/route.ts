import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeText } from "@/lib/analysis";
import { db } from "@/lib/db";
import {
  contentHash,
  decodeUpload,
  extractionPending,
  MAX_DECODED_CHARS,
  MAX_UPLOAD_BYTES,
} from "@/lib/upload";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    content: z.string().min(1, "content is required").max(50_000),
    variant: z.enum(["A", "B", "C", "D"]).default("A"),
    kind: z.enum(["paste", "file"]).default("paste"),
    contentType: z.string().optional(),
    filename: z.string().max(255).optional(),
    base64: z.string().max(MAX_UPLOAD_BYTES * 2 + 8).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind === "file" && (!val.base64 || !val.contentType)) {
      ctx.addIssue({
        code: "custom",
        message: "kind=file requires base64 and contentType",
        path: ["base64"],
      });
    }
  });

// Anonymous analyzer entrypoint (WT-2). Paste → analyze immediately.
// Uploads: text-ish types are decoded deterministically and analyzed;
// PDFs/images are acknowledged as queued (extraction lands in Phase 1).
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

  const { content, variant, kind, contentType, filename } = parsed.data;

  if (kind === "file") {
    const decoded = decodeUpload(parsed.data.base64!, contentType!, filename ?? "upload.bin");
    if (!decoded) {
      return NextResponse.json(
        { error: "Unsupported file type or file too large (max 10MB)." },
        { status: 415 },
      );
    }
    if (extractionPending(decoded.contentType)) {
      // Acknowledge, don't fake a result: the submission goes to the manual
      // review queue (WT-9) and the admin sees the original file.
      const dataUrl = `data:${decoded.contentType};base64,${parsed.data.base64}`;
      const submission = await db.submission.create({
        data: {
          variant,
          kind: "queued",
          contentType: decoded.contentType,
          filename: decoded.filename,
          sizeBytes: decoded.bytes.length,
          contentHash: contentHash(decoded.filename + ":" + decoded.bytes.length),
          content: `[File uploaded: ${decoded.filename} (${decoded.contentType})] Manual review in progress.`,
          rawBytes: parsed.data.base64,
          dataUrl,
          status: "queued",
        },
      });
      return NextResponse.json({
        id: submission.id,
        result: null,
        queued: true,
        message:
          "PDF and image extraction is coming online in Phase 1. This document has been queued for manual review.",
      });
    }

    if (decoded.decodedText === null || !decoded.decodedText) {
      return NextResponse.json(
        { error: "No readable text found in this file." },
        { status: 422 },
      );
    }

    const result = analyzeText(decoded.decodedText.slice(0, MAX_DECODED_CHARS));
    const submission = await db.submission.create({
      data: {
        variant,
        kind,
        contentType: decoded.contentType,
        filename: decoded.filename,
        sizeBytes: decoded.bytes.length,
        contentHash: contentHash(decoded.decodedText),
        content: decoded.decodedText.slice(0, MAX_DECODED_CHARS),
        status: "done",
        result: JSON.stringify(result),
        analysis: JSON.stringify({ title: result.title, exposure: result.exposureLabel }),
      },
    });
    return NextResponse.json({ id: submission.id, result, queued: false });
  }

  const result = analyzeText(content);
  const submission = await db.submission.create({
    data: {
      variant,
      kind,
      contentType: contentType ?? "text/plain",
      contentHash: contentHash(content),
      content,
      status: "done",
      result: JSON.stringify(result),
      analysis: JSON.stringify({ title: result.title, exposure: result.exposureLabel }),
    },
  });

  return NextResponse.json({ id: submission.id, result, queued: false });
}
