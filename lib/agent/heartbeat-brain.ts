/**
 * The standing loop: what changed, does it matter, and is it worth saying.
 *
 * Three gates, and all three have to open before the app speaks. Salience is
 * arithmetic and explainable. The brain is a model and can be wrong. The cursor
 * is neither — it is the thing that stops the other two from being asked twice.
 *
 * The invariant that everything else rests on: **the cursor advances over
 * everything briefed, including the events the brain chose to stay quiet
 * about.** Silence is a verdict, not a deferral. Without this the same event
 * comes back every fifteen minutes forever, and an agent that keeps
 * re-litigating yesterday is worse than one that says nothing.
 */

import { split } from "./salience";
import { parseDecision, PROACTIVE_SYSTEM, type ProactiveDecision } from "./proactive";
import type { SreEvent } from "./events";
import {
  eventsForBeat,
  readHeartbeatState,
  withBeatLock,
  writeHeartbeatState,
} from "@/lib/store/events";
import { appendMessage, HOME_CONVERSATION_ID } from "@/lib/store/conversations";
import { fenceWithNotice } from "./untrusted-content";
import type { MockMessage } from "@/lib/mock/fixtures";

const REASONING_MODEL = "claude-sonnet-5";

export interface BeatResult {
  considered: number;
  mattered: number;
  spoke: boolean;
  message?: string;
  /** Why nothing was said, when nothing was. Read by the debug surface. */
  silentBecause?: string;
}

/**
 * The briefing.
 *
 * Written as a person would brief a colleague coming back from lunch, because
 * that is the judgement being asked for. Evidence refs are included so the
 * message the brain writes can cite one — a claim the user cannot check is the
 * thing the whole product is trying not to be.
 */
export function buildBriefing(events: readonly SreEvent[]): string {
  const lines = events.map((event) => {
    const parts = [`- [${event.severity}] ${event.source}: ${event.headline}`];
    if (event.summary) parts.push(`  ${event.summary}`);
    if (event.actionItems.length > 0) {
      parts.push(`  next: ${event.actionItems.join("; ")}`);
    }
    if (event.evidence.length > 0) {
      parts.push(
        `  evidence: ${event.evidence
          .map((item) => `${item.kind}:${item.ref}${item.label ? ` (${item.label})` : ""}`)
          .join(", ")}`,
      );
    }
    parts.push(`  eventRef: ${event.id}`);
    return parts.join("\n");
  });

  return [
    "You just woke on your periodic check. Since you last spoke to the user, your",
    "SRE engineer reported the following:",
    "",
    ...lines,
    "",
    "Decide whether any of this is worth a message right now. If you speak, cite the",
    "evidence ref or the event so they can check it themselves.",
  ].join("\n");
}

function apiHeaders(): HeadersInit | null {
  const key = process.env.CHAT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (key) {
    return { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key };
  }
  const oauth = process.env.CLAUDE_OAUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!oauth) return null;
  return {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20",
    authorization: `Bearer ${oauth}`,
  };
}

/**
 * Ask the brain. No tools, one call, and it fails closed.
 *
 * An unreachable model must produce silence, never a fallback sentence: a
 * background loop that invents something to say when it cannot think is the
 * exact failure the salience bar exists to prevent.
 */
export async function askProactiveBrain(briefing: string): Promise<ProactiveDecision> {
  const headers = apiHeaders();
  if (!headers) return { speak: false, message: "" };

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: REASONING_MODEL,
        max_tokens: 400,
        system: PROACTIVE_SYSTEM,
        // The briefing is built from what another agent sent us, so it is
        // fenced like any other content this one did not write.
        messages: [{ role: "user", content: fenceWithNotice(briefing, "third-party content") }],
      }),
    });
    if (!response.ok) return { speak: false, message: "" };

    const payload = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    return parseDecision(text);
  } catch {
    return { speak: false, message: "" };
  }
}

/** The worst thing in the batch, which is the edge the message wears. */
function severityFor(events: readonly SreEvent[]): MockMessage["severity"] {
  const order = ["critical", "high", "medium", "low"] as const;
  for (const level of order) {
    if (events.some((event) => event.severity === level)) return level;
  }
  return "low";
}

/** One tick. Safe to call from the interval and from an early wake at once. */
export function runHeartbeat(): Promise<BeatResult> {
  return withBeatLock(async () => {
    const state = await readHeartbeatState();
    const considered = await eventsForBeat(state);
    if (considered.length === 0) {
      return { considered: 0, mattered: 0, spoke: false, silentBecause: "nothing new" };
    }

    const { mattering } = split(considered);

    // The cursor moves over everything considered, whatever happens next — and
    // it moves **before** the model call, not after.
    //
    // Writing it afterwards left the batch eligible for the eight seconds the
    // brain was thinking, so a beat that overlapped that window briefed the
    // same events again and paid for a second opinion on them. The in-process
    // lock does not close this: the standing loop and the route handlers are
    // separate module instances under `next dev`, so they hold separate locks.
    // Advancing first is also what the invariant already says out loud —
    // silence is a verdict, so a batch is spent once it has been asked about,
    // whatever the answer turns out to be.
    await writeHeartbeatState({
      lastSeen: considered.at(-1)?.at ?? state.lastSeen,
      announced: [...state.announced, ...considered.map((event) => event.id)],
    });

    if (mattering.length === 0) {
      return {
        considered: considered.length,
        mattered: 0,
        spoke: false,
        silentBecause: "nothing cleared the salience bar",
      };
    }

    const decision = await askProactiveBrain(buildBriefing(mattering));

    if (!decision.speak || !decision.message) {
      return {
        considered: considered.length,
        mattered: mattering.length,
        spoke: false,
        silentBecause: "the brain chose silence",
      };
    }

    // Idempotent by construction: the id is derived from the batch, so the same
    // beat replayed writes a line the reader collapses rather than a second one.
    const batchKey = mattering.map((event) => event.id).join("|");
    await appendMessage(HOME_CONVERSATION_ID, {
      id: `hb-${hash(batchKey)}`,
      role: "agent",
      text: decision.message,
      at: new Date().toISOString(),
      read: false,
      severity: severityFor(mattering),
      source: "heartbeat",
      sessionId: mattering[0]?.sessionId,
      eventRef: mattering[0]?.id,
    });

    return {
      considered: considered.length,
      mattered: mattering.length,
      spoke: true,
      message: decision.message,
    };
  });
}

/** FNV-1a. Short, stable, and not trying to be a hash function that matters. */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
