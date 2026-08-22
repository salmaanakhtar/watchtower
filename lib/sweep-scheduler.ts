// WT-6: sweep scheduler. Runs the notification sweep on an interval inside
// the Next.js server process (started from instrumentation.ts register()).
//
// Guard rails:
//   - only runs when notifications are configured (RESEND_API_KEY) or when
//     explicitly forced via NOTIFY_SWEEP_FORCE=1 (dev testing)
//   - never overlaps: a run already in flight is skipped
//   - failure isolation: an errored sweep is logged and the next tick retries
//   - process-local (no cross-instance lock): the sweep's notifiedAt/Event
//     guard makes duplicate sends impossible even with concurrent runs

import { runSweep } from "@/lib/notify-sweep";

export const SWEEP_INTERVAL_MS = Number(process.env.NOTIFY_SWEEP_INTERVAL_MS ?? 3_600_000); // 1h default

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let started = false;

function sweepEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY) || process.env.NOTIFY_SWEEP_FORCE === "1";
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const stats = await runSweep();
    if (stats.selected > 0) {
      console.log(
        `[wt6:sweep] selected=${stats.selected} sent=${stats.sent} failed=${stats.failed} skipped=${stats.skipped}`,
      );
    }
  } catch (err) {
    console.error("[wt6:sweep] sweep failed:", err);
  } finally {
    running = false;
  }
}

/** Start the interval (once). No-op when the sweep is disabled. */
export function startSweepScheduler(): void {
  if (started) return;
  started = true;
  if (!sweepEnabled()) {
    console.log("[wt6:sweep] disabled (set RESEND_API_KEY or NOTIFY_SWEEP_FORCE=1)");
    return;
  }
  console.log(`[wt6:sweep] scheduler started (every ${Math.round(SWEEP_INTERVAL_MS / 60_000)}min)`);
  void tick(); // run once on startup, then on the interval
  timer = setInterval(tick, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

/** Stop the interval (used in tests). */
export function stopSweepScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
