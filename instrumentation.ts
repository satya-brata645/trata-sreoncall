/**
 * Server boot.
 *
 * Next calls `register` once per server process, which is the only hook that
 * exists for "start something that outlives a request". The heartbeat is the
 * one thing in this app that has to run when nobody is looking, so this is
 * where it starts.
 *
 * Guarded on the Node runtime because the edge runtime has no timers that
 * survive a response, and importing the store there would fail on `node:fs`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startHeartbeat } = await import("./lib/agent/heartbeat-runner");
  startHeartbeat();
}
