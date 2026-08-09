/**
 * Memory traces are the small, explainable units shared by the memory tiers.
 *
 * This module deliberately has no I/O and no ambient clock. The heartbeat owns
 * when a trace is touched; these functions only make the resulting ranking
 * reproducible and testable.
 */

import type { SreEvent } from "../events";

export type MemoryTier = "stm" | "mtm" | "ltm";
export type MemoryKind = "incident" | "hypothesis" | "episode" | "fact" | "procedure";

export interface MemoryTrace {
  id: string;
  tier: MemoryTier;
  kind: MemoryKind;
  signature: string;
  strength: number;
  hits: number;
  lastHitAt: string;
  createdAt: string;
  confirmations: number;
  contradictions: number;
  evidence: SreEvent["evidence"];
  sourceEventIds: string[];
  incidentId?: string;
  headline?: string;
  summary?: string;
  openedAt?: string;
  resolvedAt?: string;
  ttdMs?: number;
  ttmMs?: number;
  ttrMs?: number;
  /** Decayed access frequency, used for graph activity rather than belief strength. */
  activity?: number;
}

export const HALF_LIFE_MS: Readonly<Record<MemoryTier, number>> = {
  stm: 45 * 60_000,
  mtm: 3 * 24 * 60 * 60_000,
  ltm: 90 * 24 * 60 * 60_000,
};

const REINFORCEMENT_ALPHA: Readonly<Record<MemoryTier, number>> = {
  stm: 0.4,
  mtm: 0.25,
  ltm: 0.15,
};

export const STM_CAP = 7;
export const MTM_CAP = 200;

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function signatureForEvent(event: Pick<SreEvent, "source" | "kind" | "severity" | "headline">): string {
  return `${event.source}:${event.kind}:${event.severity}:${slug(event.headline)}`;
}

export function decayTrace(trace: MemoryTrace, now: Date): MemoryTrace {
  const elapsed = Math.max(0, now.getTime() - Date.parse(trace.lastHitAt));
  const multiplier = 2 ** (-elapsed / HALF_LIFE_MS[trace.tier]);
  return {
    ...trace,
    strength: trace.strength * multiplier,
    activity: (trace.activity ?? 0) * multiplier,
  };
}

/** Saturating reinforcement preserves the 0..1 invariant without clamping. */
export function reinforceTrace(trace: MemoryTrace, salience: number, now: Date): MemoryTrace {
  const alpha = REINFORCEMENT_ALPHA[trace.tier];
  const boost = alpha * Math.max(0, Math.min(1, salience));
  return {
    ...trace,
    strength: 1 - (1 - trace.strength) * (1 - boost),
    activity: 1 - (1 - (trace.activity ?? 0)) * (1 - boost),
    hits: trace.hits + 1,
    lastHitAt: now.toISOString(),
  };
}

export function confidenceFor(trace: Pick<MemoryTrace, "confirmations" | "contradictions">): number {
  return (trace.confirmations + 1) / (trace.confirmations + trace.contradictions + 2);
}

export function traceForEvent(event: SreEvent): MemoryTrace {
  return {
    id: `stm-${event.id}`,
    tier: "stm",
    kind: event.kind === "diagnosis" ? "hypothesis" : "incident",
    signature: signatureForEvent(event),
    strength: 0.35,
    hits: 1,
    lastHitAt: event.receivedAt,
    createdAt: event.receivedAt,
    confirmations: event.kind === "resolved" ? 1 : 0,
    contradictions: 0,
    evidence: event.evidence,
    sourceEventIds: [event.id],
    incidentId: event.incidentId,
    headline: event.headline,
    summary: event.summary,
    activity: 0.35,
  };
}

/**
 * A learning is not a transient observation, so it does not enter short-term
 * memory and wait to prove itself worth keeping.
 *
 * The distinction is categorical rather than numeric: an incident report is a
 * thing that happened, and most of them stop mattering within the hour. A
 * learning is a lesson the SRE agent has already written down, cited to real
 * evidence, and committed to a file — it arrived durable. Sending it through
 * the same short-term decay as a routine detection would mean the agent could
 * forget something it deliberately chose to remember, which is the opposite of
 * the point.
 *
 * `procedure` for something that changes how work is done, `fact` for something
 * observed about the system. Both are long-term kinds already.
 */
export function traceForLearning(event: SreEvent): MemoryTrace | null {
  const learning = event.learning;
  if (!learning) return null;
  const isHowTo = learning.artifactKind === "playbook" || learning.artifactKind === "skill";
  return {
    id: `ltm-${event.id}`,
    tier: "ltm",
    kind: isHowTo ? "procedure" : "fact",
    signature: `learning:${learning.capability}:${learning.artifact}`,
    strength: 1,
    hits: 1,
    lastHitAt: event.receivedAt,
    createdAt: event.receivedAt,
    // A lesson absorbed from a correction starts as a contradiction of what the
    // agent previously believed — recording that is the honest shape, and it is
    // what makes "this belief changed, and here is what changed it" legible
    // later rather than the belief simply appearing fully-formed.
    confirmations: learning.origin === "correction-absorbed" ? 0 : 1,
    contradictions: learning.origin === "correction-absorbed" ? 1 : 0,
    evidence: event.evidence,
    sourceEventIds: [event.id],
    incidentId: event.incidentId,
    headline: event.headline,
    summary: learning.lesson,
    activity: 1,
  };
}

export function rankTraces<T extends MemoryTrace>(traces: readonly T[]): T[] {
  return [...traces].sort((a, b) => b.strength - a.strength || b.lastHitAt.localeCompare(a.lastHitAt));
}
