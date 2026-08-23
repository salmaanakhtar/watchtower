// WT-11: reputation sweep scheduler. Runs the reputation health check on an
// interval inside the Next.js server process (started from
// instrumentation.ts). Guards mirror lib/sweep-scheduler.ts: enabled only
// when the notification sender is configured (so alerts can be delivered) or
// forced for dev, never overlapping, failure-isolated.

import { runReputationSweep } from "@/lib/reputation";
import { isProdEmailEnabled } from "@/lib/notifications";

export const REPUTATION_SWEEP_INTERVAL_MS = Number(
  process.env.REPUTATION_SWEEP_INTERVAL_MS ?? 86_400_000,
); // 1x/day default

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let started = false;

function enabled(): boolean {
  return isProdEmailEnabled() || process.env.REPUTATION_SWEEP_FORCE === "1";
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const { healthy, alertSent } = await runReputationSweep();
    if (!healthy) {
      console.log(`[wt11:reputation] sweep degraded, alertSent=${alertSent}`);
    }
  } catch (err) {
    console.error("[wt11:reputation] sweep failed:", err);
  } finally {
    running = false;
  }
}

/** Start the interval (once). No-op when disabled. */
export function startReputationScheduler(): void {
  if (started) return;
  started = true;
  if (!enabled()) {
    console.log("[wt11:reputation] disabled (set RESEND_API_KEY or REPUTATION_SWEEP_FORCE=1)");
    return;
  }
  console.log(
    `[wt11:reputation] scheduler started (every ${Math.round(REPUTATION_SWEEP_INTERVAL_MS / 3_600_000)}h)`,
  );
  void tick();
  timer = setInterval(tick, REPUTATION_SWEEP_INTERVAL_MS);
  timer.unref?.();
}

/** Stop the interval (used in tests). */
export function stopReputationScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
