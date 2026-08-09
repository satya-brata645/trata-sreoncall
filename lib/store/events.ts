import { promises as fs } from "node:fs";
import path from "node:path";

import { scopeKey } from "@/lib/auth/scope";
import type { SreEvent } from "@/lib/agent/events";

/**
 * The event log and the heartbeat's place in it.
 *
 * Same append-only NDJSON shape as the conversation store, for the same reason:
 * the ingest route and the heartbeat run concurrently and neither should have
 * to hold a lock. Deduping by id on read is what makes a producer's retry
 * harmless.
 *
 * The cursor is the other half. It is read-modify-write, which the log
 * deliberately is not — but only the heartbeat writes it, and only one beat
 * runs at a time, so the single in-process guard below is the whole concurrency
 * story.
 */

const LOOKBACK_DAYS = 2;
const ANNOUNCED_CAP = 500;

export interface HeartbeatState {
  /** Everything at or before this is settled, spoken about or not. */
  lastSeen: string;
  /** Event ids already put to the brain, so a silent verdict is not re-asked. */
  announced: string[];
}

function root(): string {
  return path.join(process.cwd(), ".data", scopeKey());
}

const eventsPath = () => path.join(root(), "events.ndjson");
const statePath = () => path.join(root(), "heartbeat-state.json");

export async function appendEvent(event: SreEvent): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
  await fs.appendFile(eventsPath(), `${JSON.stringify(event)}\n`, "utf8");
}

export async function readEvents(): Promise<SreEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsPath(), "utf8");
  } catch {
    return [];
  }

  const byId = new Map<string, SreEvent>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SreEvent;
      // **First occurrence wins.** A retry is the same event arriving again,
      // not a correction of it — and the retry carries a fresh server `at` and
      // whatever fields the producer happened to resend. Letting it overwrite
      // moved an incident's start time forward and dropped the action items
      // from the original, which is how a replay rewrote history instead of
      // being ignored.
      if (parsed && typeof parsed.id === "string" && !byId.has(parsed.id)) {
        byId.set(parsed.id, parsed);
      }
    } catch {
      // A torn line costs one event, not the log.
    }
  }
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export async function readHeartbeatState(): Promise<HeartbeatState> {
  try {
    const raw = await fs.readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<HeartbeatState>;
    return {
      lastSeen: typeof parsed.lastSeen === "string" ? parsed.lastSeen : new Date(0).toISOString(),
      announced: Array.isArray(parsed.announced) ? parsed.announced.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return { lastSeen: new Date(0).toISOString(), announced: [] };
  }
}

export async function writeHeartbeatState(state: HeartbeatState): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
  // Unique temp name, then rename. A fixed one (`state.json.tmp`) is the bug
  // MCS shipped: two writers stage into the same path and the second `rename`
  // finds nothing there.
  const temp = `${statePath()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const trimmed: HeartbeatState = {
    lastSeen: state.lastSeen,
    announced: state.announced.slice(-ANNOUNCED_CAP),
  };
  await fs.writeFile(temp, JSON.stringify(trimmed, null, 2), "utf8");
  await fs.rename(temp, statePath());
}

/**
 * The events this beat should consider.
 *
 * Bounded three ways — a lookback window, the cursor, and a per-beat cap — so a
 * backlog produces one sensible message rather than a burst. Oldest first,
 * because a briefing that reads in the order things happened is a briefing the
 * brain can reason about causally.
 */
export async function eventsForBeat(
  state: HeartbeatState,
  limit = 10,
): Promise<SreEvent[]> {
  const events = await readEvents();
  const floor = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const announced = new Set(state.announced);

  return events
    .filter((event) => event.at > floor && event.at > state.lastSeen && !announced.has(event.id))
    .slice(0, limit);
}

/**
 * One beat at a time.
 *
 * The cursor is the one read-modify-write in the proactive path, and the
 * early-wake trigger can land on top of the interval. Serialising here is
 * cheaper and clearer than making the cursor a log too.
 */
let beating: Promise<unknown> = Promise.resolve();

export function withBeatLock<T>(run: () => Promise<T>): Promise<T> {
  const next = beating.then(run, run);
  beating = next.catch(() => undefined);
  return next;
}
