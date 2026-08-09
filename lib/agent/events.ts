/**
 * What the SRE agent tells this one.
 *
 * Trata's agent is the manager, not the engineer. It does not query Mimir, read
 * a log stream or search traces — a separate SRE agent does that work and posts
 * what it found here. This module is the contract between the two, and it is
 * the one thing in the proactive path that cannot be changed cheaply later:
 * everything downstream can be rewritten, but once the SRE agent is writing
 * against this shape, the shape is load-bearing.
 *
 * So it is deliberately narrow. An event says what happened, how bad it is, and
 * what a person could point at to check — not the raw telemetry. Evidence is
 * references, never payloads, because the value of "cites a real trace id" is
 * that someone can go and look, and a copied-in log line is a claim rather than
 * a citation.
 */

export type EventSeverity = "critical" | "high" | "medium" | "low" | "info";

/**
 * The kinds are a closed set on purpose. `resolved` is in it because an agent
 * that only ever hears about breakage will keep reporting a fixed problem —
 * recovery has to be sayable for the picture to stay true.
 */
export type EventKind =
  | "detection"
  | "incident"
  | "diagnosis"
  | "remediation"
  | "resolved"
  | "report";

export interface EventEvidence {
  /** What sort of thing this points at, so the UI can badge it. */
  kind: "metric" | "log" | "trace" | "pr" | "dashboard" | "runbook" | "other";
  /** The identifier a person would paste somewhere to see it themselves. */
  ref: string;
  label?: string;
}

/** What a producer sends. Everything else is stamped on arrival. */
export interface SreEventInput {
  /** Which agent or system is speaking. */
  source: string;
  kind: EventKind;
  severity: EventSeverity;
  /** One line. This is what the brain reads first and often all it needs. */
  headline: string;
  summary?: string;
  actionItems?: string[];
  evidence?: EventEvidence[];
  sessionId?: string;
  incidentId?: string;
  /**
   * How sure the SRE agent is, 0–1, when it has a number worth reporting.
   *
   * Optional and never inferred. A confidence this side invented would be a
   * number with no method behind it, displayed next to numbers that have one —
   * so an event without it renders as absent rather than as a guess.
   */
  confidence?: number;
  /** The producer's own id for this event, if it has one. Used for dedupe. */
  externalId?: string;
  at?: string;
}

export interface SreEvent extends SreEventInput {
  /** Stable and derived, so the same event posted twice is one event. */
  id: string;
  at: string;
  receivedAt: string;
  actionItems: string[];
  evidence: EventEvidence[];
}

const SEVERITIES: readonly EventSeverity[] = ["critical", "high", "medium", "low", "info"];
const KINDS: readonly EventKind[] = [
  "detection",
  "incident",
  "diagnosis",
  "remediation",
  "resolved",
  "report",
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/**
 * Parse and stamp, or say what is wrong.
 *
 * Returns a reason rather than throwing because the producer is another agent:
 * a 400 that names the missing field is something it can act on, and an
 * exception is not.
 */
export function parseEvent(raw: unknown): SreEvent | { error: string } {
  const input = (raw ?? {}) as Partial<SreEventInput>;

  if (typeof input.source !== "string" || !input.source.trim()) {
    return { error: "`source` is required — name the agent or system reporting this." };
  }
  if (typeof input.headline !== "string" || !input.headline.trim()) {
    return { error: "`headline` is required — one line saying what happened." };
  }
  if (!KINDS.includes(input.kind as EventKind)) {
    return { error: `\`kind\` must be one of: ${KINDS.join(", ")}.` };
  }
  if (!SEVERITIES.includes(input.severity as EventSeverity)) {
    return { error: `\`severity\` must be one of: ${SEVERITIES.join(", ")}.` };
  }

  const at = typeof input.at === "string" && !Number.isNaN(Date.parse(input.at))
    ? new Date(input.at).toISOString()
    : new Date().toISOString();

  // Derived, not random: an SRE agent that retries a failed POST must not
  // produce a second event, and it should not have to send an id to get that.
  const id = typeof input.externalId === "string" && input.externalId.trim()
    ? `evt-${slug(input.source)}-${slug(input.externalId)}`
    : `evt-${slug(input.source)}-${slug(input.headline)}-${at.slice(0, 19)}`;

  return {
    id,
    at,
    receivedAt: new Date().toISOString(),
    source: input.source.trim(),
    kind: input.kind as EventKind,
    severity: input.severity as EventSeverity,
    headline: input.headline.trim(),
    summary: typeof input.summary === "string" ? input.summary.trim() : undefined,
    actionItems: Array.isArray(input.actionItems)
      ? input.actionItems.filter((item): item is string => typeof item === "string" && !!item.trim())
      : [],
    evidence: Array.isArray(input.evidence)
      ? (input.evidence as EventEvidence[]).filter(
          (item) => item && typeof item.ref === "string" && !!item.ref.trim(),
        )
      : [],
    sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
    incidentId: typeof input.incidentId === "string" ? input.incidentId : undefined,
    confidence:
      typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1
        ? input.confidence
        : undefined,
    externalId: typeof input.externalId === "string" ? input.externalId : undefined,
  };
}
