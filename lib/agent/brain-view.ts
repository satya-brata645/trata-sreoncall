/**
 * Turning the event log into the picture Brain draws.
 *
 * Brain's whole claim is *what it believes and where each belief came from*.
 * Until now it rendered that from module constants, which made it a very good
 * drawing of an agent and no evidence of one. These functions are the join: an
 * incident, its competing explanations, and its running commentary, every field
 * traceable to an event the SRE agent actually sent.
 *
 * Pure on purpose — no fetch, no React, no clock beyond what is passed in — so
 * the derivation is testable without a browser, the same way `agentProtocol` is.
 * Anything the events do not say comes back `undefined` rather than invented;
 * the renderer is expected to show a gap as a gap.
 */

import type { EventSeverity, SreEvent } from "./events";

export interface DerivedIncident {
  id: string;
  severity: string;
  title: string;
  status: string;
  /** Absent unless the SRE agent reported one. Never inferred. */
  confidence?: number;
  startedAt: string;
  summary?: string;
  nextAction?: string;
  /** The events this was built from, newest first, for the receipts. */
  events: SreEvent[];
}

export interface DerivedHypothesis {
  id: string;
  statement: string;
  confidence?: number;
  evidence?: string;
  status: "leading" | "active" | "watching";
}

export interface DerivedMemoryEntry {
  id: string;
  at: string;
  speaker: string;
  text: string;
}

/** P-levels, because that is the vocabulary the incident header already speaks. */
const SEVERITY_LABEL: Record<EventSeverity, string> = {
  critical: "P1",
  high: "P2",
  medium: "P3",
  low: "P4",
  info: "P5",
};

/** What the newest event about an incident implies about where it has got to. */
const STATUS_FOR_KIND: Record<SreEvent["kind"], string> = {
  detection: "Triaging",
  incident: "Triaging",
  diagnosis: "Diagnosing",
  remediation: "Remediating",
  resolved: "Resolved",
  report: "Reviewing",
  // A learning says something about the agent, not about where an incident has
  // got to. Present so the map stays exhaustive; `deriveIncident` filters these
  // out before status is chosen, so this label should not normally be reachable.
  learning: "Learned",
};

const RANK: Record<EventSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * The incident currently worth looking at.
 *
 * The newest one, resolved or not — a resolved incident stays on screen because
 * "it recovered" is the most useful thing the panel can be saying in the minutes
 * after it does. Events without an `incidentId` are ignored here; they are
 * reports, not an incident, and inventing an incident to hold them would be the
 * fabrication this whole layer exists to remove.
 */
export function deriveIncident(events: readonly SreEvent[]): DerivedIncident | null {
  const grouped = new Map<string, SreEvent[]>();
  for (const event of events) {
    if (!event.incidentId) continue;
    // A learning often cites the incident that taught it, but it reports on the
    // agent rather than on the incident's progress. Letting it in here would
    // make an incident's status read "Learned" — and, worse, would let a lesson
    // written days later resurface a long-finished incident as the newest thing
    // happening.
    if (event.kind === "learning") continue;
    const bucket = grouped.get(event.incidentId) ?? [];
    bucket.push(event);
    grouped.set(event.incidentId, bucket);
  }
  if (grouped.size === 0) return null;

  // Newest activity wins. `events` arrives oldest-first from the store.
  let chosen: { id: string; group: SreEvent[] } | null = null;
  for (const [id, group] of grouped) {
    const latest = group.at(-1)!.at;
    if (!chosen || latest > chosen.group.at(-1)!.at) chosen = { id, group };
  }
  if (!chosen) return null;

  const group = [...chosen.group].sort((a, b) => a.at.localeCompare(b.at));
  const first = group[0]!;
  const latest = group.at(-1)!;
  const worst = group.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a));

  return {
    id: chosen.id,
    // The worst it ever was, not the calmest thing said most recently — an
    // incident that opened at P1 does not become a P3 because the last update
    // happened to be routine.
    severity: SEVERITY_LABEL[worst.severity],
    title: first.headline,
    status: STATUS_FOR_KIND[latest.kind],
    // How sure it is *of its leading explanation*, which is the only reading of
    // "84% confident" that means anything. Taking the most recent number
    // instead reported the confidence of whichever theory was mentioned last —
    // so posting a weak alternative made the incident look less understood
    // than it was.
    confidence: incidentConfidence(group),
    startedAt: first.at,
    summary: [...group].reverse().find((event) => event.summary)?.summary,
    nextAction: [...group].reverse().find((event) => event.actionItems.length > 0)?.actionItems[0],
    events: [...group].reverse(),
  };
}

/**
 * How confident the incident is: the leading diagnosis, if there is one.
 *
 * Falls back to the most recent reported number only when nothing has been
 * diagnosed yet — at that point "confidence" can only mean confidence in the
 * detection itself, which is what a detection's own number is.
 */
function incidentConfidence(group: readonly SreEvent[]): number | undefined {
  const diagnosed = group
    .filter((event) => event.kind === "diagnosis" && event.confidence !== undefined)
    .map((event) => event.confidence!);
  if (diagnosed.length > 0) return Math.max(...diagnosed);
  return [...group].reverse().find((event) => event.confidence !== undefined)?.confidence;
}

/**
 * The competing explanations, ranked.
 *
 * Only `diagnosis` events become hypotheses. The other kinds are things that
 * happened, not things that might be true, and folding them in would turn a
 * ranked set of beliefs into a feed.
 */
export function deriveHypotheses(events: readonly SreEvent[]): DerivedHypothesis[] {
  const diagnoses = events.filter((event) => event.kind === "diagnosis");
  if (diagnoses.length === 0) return [];

  const ranked = [...diagnoses].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  return ranked.map((event, index) => ({
    id: event.id,
    statement: event.headline,
    confidence: event.confidence,
    evidence:
      event.evidence[0] &&
      `${event.evidence[0].label ?? event.evidence[0].kind}: ${event.evidence[0].ref}`,
    // One leading explanation, never two. A panel showing two leading theories
    // is a panel that has not decided anything.
    status: index === 0 ? "leading" : (event.confidence ?? 0) >= 0.5 ? "active" : "watching",
  }));
}

/**
 * The running commentary.
 *
 * `T+2m` style stamps, relative to the first event, because what matters when
 * reading an incident back is how far into it something was said — not the wall
 * clock, which tells you nothing without arithmetic.
 */
export function deriveWorkingMemory(events: readonly SreEvent[]): DerivedMemoryEntry[] {
  if (events.length === 0) return [];
  const origin = Date.parse(events[0]!.at);

  return events.map((event) => ({
    id: event.id,
    at: relativeStamp(Date.parse(event.at) - origin),
    speaker: event.source.toUpperCase(),
    text: event.summary?.trim() || event.headline,
  }));
}

function relativeStamp(deltaMs: number): string {
  const minutes = Math.max(0, Math.round(deltaMs / 60_000));
  if (minutes < 60) return `T+${String(minutes).padStart(2, "0")}m`;
  return `T+${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}
