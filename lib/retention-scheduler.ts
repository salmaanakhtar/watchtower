// WT-8: retention scheduler — daily in-process sweep, same pattern as the
// notification sweep (lib/sweep-scheduler.ts): never overlaps, failure
// isolated, process-local.

import { runRetention } from "@/lib/retention";

export const RETENTION_INTERVAL_MS = Number(process.env.RETENTION_INTERVAL_MS ?? 86_400_000); // daily

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let started = false;

export function retentionEnabled(): boolean {
  return process.env.RETENTION_ENABLED === "1";
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const stats = await runRetention();
    console.log(
      `[wt8:retention] deleted=${stats.deletedSubmissions} anonymized=${stats.anonymizedSubmissions} orphanDocs=${stats.deletedDocuments}`,
    );
  } catch (err) {
    console.error("[wt8:retention] sweep failed:", err);
  } finally {
    running = false;
  }
}

/** Start the daily retention sweep (once). No-op unless RETENTION_ENABLED=1. */
export function startRetentionScheduler(): void {
  if (started) return;
  started = true;
  if (!retentionEnabled()) {
    console.log("[wt8:retention] disabled (set RETENTION_ENABLED=1)");
    return;
  }
  console.log(`[wt8:retention] scheduler started (every ${Math.round(RETENTION_INTERVAL_MS / 86_400_000)}d)`);
  void tick();
  timer = setInterval(tick, RETENTION_INTERVAL_MS);
  timer.unref?.();
}

/** Stop the scheduler (used in tests). */
export function stopRetentionScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
