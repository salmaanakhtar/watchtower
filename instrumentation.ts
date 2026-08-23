// Next.js instrumentation (WT-6). Runs once per server process start.
// Starts the deadline notification sweep scheduler (see lib/notify-sweep.ts).
// The sweep is idempotent (notifiedAt/Event guard), so overlapping runs from
// multiple server instances are safe.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startSweepScheduler } = await import("@/lib/sweep-scheduler");
  startSweepScheduler();
  const { startRetentionScheduler } = await import("@/lib/retention-scheduler");
  startRetentionScheduler();
  const { startReputationScheduler } = await import("@/lib/reputation-scheduler");
  startReputationScheduler();
}
