/**
 * What the agent route actually did, kept just long enough to be asked.
 *
 * A failed turn arrives in the chat as one grey bubble carrying an exception
 * message, which is the least informative surface a failure could have: it
 * cannot say which lane ran, which tools were offered, or whether the model
 * refused or the network did. This is the answer to "why did it say that",
 * available without attaching a debugger to a dev server.
 *
 * Deliberately in memory and deliberately small. It is a debugging aid, not an
 * audit trail — the audit trail is a separate, durable thing that records what
 * the agent *did* to the desktop, and conflating the two would put model text in
 * a record that has to survive.
 */

import type { OsAgentMode } from "@/lib/os/agentProtocol";

const RING_SIZE = 20;

export interface AgentCallRecord {
  at: string;
  /** Which model actually ran, not which lane was asked for. */
  model: string;
  lane: "light" | "heavy";
  requestedMode: OsAgentMode;
  ceiling: OsAgentMode;
  mode: OsAgentMode;
  toolsOffered: string[];
  messageCount: number;
  /** Present on success. */
  outcome?: {
    textBlocks: number;
    toolCalls: string[];
    /** Set when the light lane handed the turn over. */
    deferred: boolean;
  };
  /** Present on failure. Includes the upstream body, truncated. */
  error?: string;
  durationMs: number;
}

/**
 * Module scope survives across requests in a warm Node process and resets on
 * reload, which is the lifetime we want: long enough to inspect the turn you
 * just ran, short enough that nothing here needs a retention policy.
 */
const ring: AgentCallRecord[] = [];

export function recordAgentCall(record: AgentCallRecord): void {
  ring.push(record);
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
}

/** Newest first — the turn you are debugging is almost always the last one. */
export function readAgentCalls(): AgentCallRecord[] {
  return [...ring].reverse();
}

export function agentDebugEnabled(): boolean {
  return process.env.DOS_AGENT_DEBUG === "1";
}
