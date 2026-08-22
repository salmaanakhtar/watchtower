// WT-8: append-only audit trail. Best-effort writes (never break a request).
// detail must never contain plaintext PII — use ids/hashes only.

import { db } from "@/lib/db";

export interface AuditEntry {
  actor: string; // admin | user:<id> | system | email:<hash>
  action:
    | "admin_authorized"
    | "admin_denied"
    | "admin_review"
    | "auth_request"
    | "auth_verify_success"
    | "auth_verify_failed"
    | "unwatch"
    | "retention_sweep"
    | "consent";
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({ data: entry });
  } catch (err) {
    console.error("[wt8:audit] failed to write audit log", err);
  }
}

/** Best-effort IP extraction from a Request (used by audit entries). */
export function requestIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}
