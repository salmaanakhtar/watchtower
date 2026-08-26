// WT-15: acquisition experiments — funnel instrumentation.
//
// Every acquisition funnel step is an append-only ExperimentEvent row:
//   tool_view (landing on a /tools/* page) → analysis_start (POST /api/analyses
//   with a tool) → result (result returned) → account_created (first session /
//   watch created).
// Events are joined into funnels via the anonymous session id cookie
// (wt_session_id), plus variant and optional source (utm_source from
// wt_experiment cookie set by content CTAs). IPs are stored for dedupe only —
// never exposed to any UI.

import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { TOOL_SLUGS } from "@/lib/tools";

export type ExperimentEventType =
  | "tool_view"
  | "analysis_start"
  | "result"
  | "account_created";

export interface ExperimentContext {
  tool: string | null;
  variant: string | null;
  source: string | null;
  referrer: string | null;
  ip: string | null;
}

export const EXPERIMENT_EVENT_TYPES: ExperimentEventType[] = [
  "tool_view",
  "analysis_start",
  "result",
  "account_created",
];

/** Extract the anonymous session id from a request (the wt_session_id cookie). */
export function sessionIdFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)wt_session_id=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Build the shared experiment context from a request (tool, variant, source, referrer, ip). */
export function contextFromRequest(
  req: Request,
  tool: string | null = null,
  variant: string | null = null,
): ExperimentContext {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const sourceMatch = cookieHeader.match(/(?:^|;\s*)wt_experiment=([^;]+)/);
  const referrerHeader = req.headers.get("referer") ?? null;
  let referrer: string | null = null;
  if (referrerHeader) {
    try {
      referrer = new URL(referrerHeader).hostname || null;
    } catch {
      referrer = null;
    }
  }
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]?.trim() ?? null : req.headers.get("x-real-ip");
  return {
    tool,
    variant,
    source: sourceMatch?.[1] ? decodeURIComponent(sourceMatch[1]) : null,
    referrer,
    ip,
  };
}

/** Record a funnel event. Never throws — analytics must not break the product. */
export async function recordExperimentEvent(
  event: ExperimentEventType,
  ctx: ExperimentContext,
  detail: string | null = null,
  sessionId: string | null = null,
): Promise<void> {
  try {
    await db.experimentEvent.create({
      data: {
        event,
        tool: ctx.tool,
        variant: ctx.variant,
        source: ctx.source,
        referrer: ctx.referrer,
        sessionId,
        ip: ctx.ip,
        detail,
      },
    });
  } catch (err) {
    console.error("[wt15] failed to record experiment event", err);
  }
}

/** Server-component helper: record a tool_view when a /tools/* page renders. */
export async function recordToolView(tool: string, variant: string | null = null): Promise<void> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("wt_session_id")?.value ?? null;
    const source = cookieStore.get("wt_experiment")?.value ?? null;
    await db.experimentEvent.create({
      data: {
        event: "tool_view",
        tool,
        variant,
        source: source ?? null,
        referrer: null,
        sessionId,
        ip: null,
      },
    });
  } catch (err) {
    console.error("[wt15] failed to record tool view", err);
  }
}

/**
 * Summarize funnel counts per tool (and the landing page) for the admin
 * experiment dashboard. Rows: tool, tool_view, analysis_start, result,
 * account_created.
 */
export async function experimentFunnelSummary(): Promise<
  {
    tool: string | null;
    views: number;
    starts: number;
    results: number;
    accounts: number;
  }[]
> {
  const rows = await db.experimentEvent.groupBy({
    by: ["tool", "event"],
    _count: { _all: true },
  });

  const byTool = new Map<
    string,
    { views: number; starts: number; results: number; accounts: number }
  >();
  for (const r of rows) {
    const key = r.tool ?? "landing";
    const acc = byTool.get(key) ?? { views: 0, starts: 0, results: 0, accounts: 0 };
    if (r.event === "tool_view") acc.views += r._count._all;
    else if (r.event === "analysis_start") acc.starts += r._count._all;
    else if (r.event === "result") acc.results += r._count._all;
    else if (r.event === "account_created") acc.accounts += r._count._all;
    byTool.set(key, acc);
  }

  const ordered: (string | null)[] = [null, ...TOOL_SLUGS];
  return ordered
    .map((t) => {
      const key = t ?? "landing";
      const acc = byTool.get(key) ?? { views: 0, starts: 0, results: 0, accounts: 0 };
      return { tool: t, ...acc };
    })
    .filter((r) => r.views > 0 || r.starts > 0 || r.results > 0 || r.accounts > 0);
}
