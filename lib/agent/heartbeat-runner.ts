/**
 * When the loop runs.
 *
 * Two triggers, one handler. The interval is the standing check — fifteen
 * minutes, matching MCS's cron, because the point of a heartbeat is that it
 * keeps going, not that it is fast. The early wake is what makes it
 * demonstrable: something critical arrives and the beat happens now rather
 * than up to fifteen minutes from now.
 *
 * The debounce is the whole reason `wakeEarly` is not just a call to
 * `runHeartbeat`. A failing deploy produces events in a burst; ten wakes would
 * be ten briefings and up to ten messages about one thing. Waiting a couple of
 * seconds turns that burst into one beat with the full picture, which is also
 * a better briefing than any of the ten would have been.
 *
 * In-process, which means it lives and dies with the dev server. That is the
 * right lifetime for a laptop; a deployment would point a real cron at
 * `POST /api/heartbeat` and never load this module.
 */

import { runHeartbeat, type BeatResult } from "./heartbeat-brain";

const DEFAULT_INTERVAL_SECONDS = 900;
const EARLY_WAKE_DEBOUNCE_MS = 2_500;

let interval: ReturnType<typeof setInterval> | null = null;
let earlyWake: ReturnType<typeof setTimeout> | null = null;
let lastResult: BeatResult | null = null;

async function beat(reason: string): Promise<void> {
  try {
    lastResult = await runHeartbeat();
    if (lastResult.spoke) {
      console.log(`[heartbeat] (${reason}) spoke: ${lastResult.message}`);
    } else if (lastResult.considered > 0) {
      console.log(`[heartbeat] (${reason}) silent: ${lastResult.silentBecause}`);
    }
  } catch (error) {
    // A background loop must not take the process with it.
    console.warn("[heartbeat] beat failed", error);
  }
}

/** Run a beat shortly, collapsing a burst of calls into one. */
export function wakeEarly(): void {
  if (earlyWake) clearTimeout(earlyWake);
  earlyWake = setTimeout(() => {
    earlyWake = null;
    void beat("early");
  }, EARLY_WAKE_DEBOUNCE_MS);
}

export function startHeartbeat(): void {
  if (interval) return;
  if (process.env.TRUNK_HEARTBEAT_LOCAL === "0") return;

  const seconds = Number(process.env.TRUNK_HEARTBEAT_LOCAL_SECONDS) || DEFAULT_INTERVAL_SECONDS;
  // Sleeps first. Beating on boot would fire during a hot reload and race the
  // seed, and there is nothing a beat at t=0 can know that one at t=interval
  // cannot.
  interval = setInterval(() => void beat("interval"), seconds * 1_000);
  console.log(`[heartbeat] standing loop every ${seconds}s`);
}

/** The last beat's verdict, for the debug surface. */
export function lastBeat(): BeatResult | null {
  return lastResult;
}

export { runHeartbeat };
