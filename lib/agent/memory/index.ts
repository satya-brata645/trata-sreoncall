/**
 * The heartbeat's durable memory protocols.
 *
 * Consolidation deliberately folds the event log rather than just the current
 * batch. The heartbeat cursor advances before a model call; deriving episodes
 * from the durable log makes a failed beat rebuildable instead of lossy.
 */

import type { SreEvent } from "../events";
import { score } from "../salience";
import {
  decayTrace,
  rankTraces,
  reinforceTrace,
  signatureForEvent,
  STM_CAP,
  traceForEvent,
  traceForLearning,
  type MemoryTrace,
} from "./traces";
import {
  appendEpisodes,
  appendLongTerm,
  readMemory,
  writeWorkingMemory,
  type MemoryProtocolState,
  type MemorySnapshot,
} from "@/lib/store/memory";

const HOUR_MS = 60 * 60_000;
const EPISODE_WINDOW_MS = 90 * 24 * HOUR_MS;

export interface MemoryView {
  working: MemoryTrace[];
  episodes: MemoryTrace[];
  longTerm: MemoryTrace[];
  protocols: MemorySnapshot["protocols"];
  activityByNode: Record<string, number>;
}

function isResolvedIncident(events: readonly SreEvent[]): boolean {
  return events.some((event) => event.kind === "resolved");
}

function eventSalience(event: SreEvent): number {
  // The salience module remains the source of truth. This only normalises its
  // explainable score into a reinforcement amount in 0..1.
  return Math.min(1, Math.max(0, score(event).weight / 5));
}

function episodeFor(incidentId: string, events: readonly SreEvent[], now: Date): MemoryTrace {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const first = ordered[0]!;
  const diagnosis = ordered.find((event) => event.kind === "diagnosis");
  const remediation = ordered.find((event) => event.kind === "remediation");
  const resolved = [...ordered].reverse().find((event) => event.kind === "resolved")!;
  const openedMs = Date.parse(first.at);
  const resolvedMs = Date.parse(resolved.at);

  return {
    id: `episode-${incidentId}`,
    tier: "mtm",
    kind: "episode",
    signature: signatureForEvent(first),
    strength: 0.75,
    hits: ordered.length,
    lastHitAt: now.toISOString(),
    createdAt: now.toISOString(),
    confirmations: 1,
    contradictions: 0,
    evidence: ordered.flatMap((event) => event.evidence),
    sourceEventIds: ordered.map((event) => event.id),
    incidentId,
    headline: first.headline,
    summary: resolved.summary ?? remediation?.summary ?? diagnosis?.summary ?? first.summary,
    openedAt: first.at,
    resolvedAt: resolved.at,
    ttdMs: diagnosis ? Math.max(0, Date.parse(diagnosis.at) - openedMs) : undefined,
    ttmMs: remediation ? Math.max(0, Date.parse(remediation.at) - openedMs) : undefined,
    ttrMs: Math.max(0, resolvedMs - openedMs),
    activity: 0.25,
  };
}

function consolidatableEpisodes(events: readonly SreEvent[], existing: readonly MemoryTrace[], now: Date): MemoryTrace[] {
  const cutoff = now.getTime() - EPISODE_WINDOW_MS;
  const grouped = new Map<string, SreEvent[]>();
  for (const event of events) {
    if (!event.incidentId || Date.parse(event.at) < cutoff) continue;
    const group = grouped.get(event.incidentId) ?? [];
    group.push(event);
    grouped.set(event.incidentId, group);
  }
  const existingIds = new Set(existing.map((trace) => trace.id));
  const episodes: MemoryTrace[] = [];
  for (const [incidentId, incidentEvents] of grouped) {
    if (!isResolvedIncident(incidentEvents)) continue;
    const episode = episodeFor(incidentId, incidentEvents, now);
    if (!existingIds.has(episode.id)) episodes.push(episode);
  }
  return episodes;
}

function protocolState(
  current: Record<string, MemoryProtocolState>,
  name: string,
  now: Date,
  error?: unknown,
): Record<string, MemoryProtocolState> {
  return {
    ...current,
    [name]: {
      lastRunAt: now.toISOString(),
      ...(error ? { lastError: error instanceof Error ? error.message : String(error) } : {}),
    },
  };
}

function activityFor(view: Pick<MemoryView, "working" | "episodes" | "longTerm">, events: readonly SreEvent[] = [], now = new Date()): Record<string, number> {
  const mean = (traces: readonly MemoryTrace[]) =>
    traces.length ? traces.reduce((total, trace) => total + (trace.activity ?? 0), 0) / traces.length : 0;
  const top = (traces: readonly MemoryTrace[]) => rankTraces(traces)[0]?.strength ?? 0;
  const ltmFacts = view.longTerm.filter((trace) => trace.kind === "fact");
  const ltmProcedures = view.longTerm.filter((trace) => trace.kind === "procedure");
  const recent = events.filter((event) => Date.parse(event.receivedAt) >= now.getTime() - HOUR_MS);
  const evidenceCount = (kind: string) => recent.filter((event) => event.evidence.some((item) => item.kind === kind)).length;
  const normaliseCount = (count: number) => Math.min(1, count / 3);
  return {
    memory: Math.max(mean(view.working), mean(view.episodes), mean(view.longTerm)),
    working: view.working.length / STM_CAP,
    hyp: top(view.working.filter((trace) => trace.kind === "hypothesis")),
    nextq: top(view.working.filter((trace) => trace.kind === "incident")),
    episodic: mean(view.episodes),
    inc2441: top(view.episodes),
    sev2: Math.min(1, view.episodes.length / 3),
    semantic: mean(ltmFacts),
    topology: top(ltmFacts),
    nodeclasses: Math.min(1, ltmFacts.length / 3),
    procedural: mean(ltmProcedures),
    checklist: top(ltmProcedures),
    handoff: Math.min(1, ltmProcedures.length / 3),
    perception: normaliseCount(recent.length),
    alerts: normaliseCount(recent.filter((event) => event.kind === "detection" || event.kind === "incident").length),
    metrics: normaliseCount(evidenceCount("metric")),
    alloc: normaliseCount(evidenceCount("metric")),
    logs: normaliseCount(evidenceCount("log")),
    oomk: normaliseCount(evidenceCount("log")),
    events: normaliseCount(recent.filter((event) => event.kind === "report").length),
  };
}

export async function memoryView(now = new Date(), events: readonly SreEvent[] = []): Promise<MemoryView> {
  const snapshot = await readMemory();
  const view = {
    working: rankTraces(snapshot.working.map((trace) => decayTrace(trace, now))).slice(0, STM_CAP),
    episodes: rankTraces(snapshot.episodes.map((trace) => decayTrace(trace, now))).slice(0, 200),
    longTerm: rankTraces(snapshot.longTerm.map((trace) => decayTrace(trace, now))),
    protocols: snapshot.protocols,
  };
  return { ...view, activityByNode: activityFor(view, events, now) };
}

/**
 * Bind, decay, reinforce, consolidate, evict and publish one deterministic
 * memory beat. Each step reports in protocol state so a memory failure is
 * inspectable without preventing the heartbeat from doing its other work.
 */
export async function runMemoryProtocols(events: readonly SreEvent[], touched: readonly SreEvent[], now = new Date()): Promise<MemoryView> {
  const snapshot = await readMemory();
  let protocols = snapshot.protocols;
  let working = snapshot.working.map((trace) => decayTrace(trace, now));
  protocols = protocolState(protocols, "decay", now);

  try {
    const byId = new Map(working.map((trace) => [trace.id, trace]));
    for (const event of touched) {
      // A learning bypasses short-term memory entirely — see traceForLearning.
      // It is a lesson the SRE agent already committed to a file, not an
      // observation still earning its place.
      if (event.kind === "learning") continue;
      const incoming = traceForEvent(event);
      const current = byId.get(incoming.id);
      byId.set(incoming.id, current ? reinforceTrace(current, eventSalience(event), now) : reinforceTrace(incoming, eventSalience(event), now));
    }
    working = [...byId.values()];
    protocols = protocolState(protocols, "bind-reinforce", now);
  } catch (error) {
    protocols = protocolState(protocols, "bind-reinforce", now, error);
  }

  // What the SRE agent learned becomes what this agent knows.
  //
  // This is the join that did not exist before: a lesson earned while triaging
  // stayed inside the triage agent, so every other surface kept making the
  // mistake it had already learned to avoid. Learnings land straight in
  // long-term memory, deduped by artifact, so re-posting the same learning
  // updates it rather than accumulating copies of it.
  let longTerm = snapshot.longTerm;
  try {
    const learnings = touched
      .filter((event) => event.kind === "learning")
      .map(traceForLearning)
      .filter((trace): trace is MemoryTrace => trace !== null);
    if (learnings.length) {
      const known = new Set(longTerm.map((trace) => trace.signature));
      const fresh = learnings.filter((trace) => !known.has(trace.signature));
      if (fresh.length) await appendLongTerm(fresh);
      longTerm = [
        ...longTerm.map((trace) => {
          const update = learnings.find((l) => l.signature === trace.signature);
          return update ? { ...trace, ...update, hits: trace.hits + 1 } : trace;
        }),
        ...fresh,
      ];
    }
    protocols = protocolState(protocols, "learn", now);
  } catch (error) {
    protocols = protocolState(protocols, "learn", now, error);
  }

  let episodes = snapshot.episodes;
  try {
    const newEpisodes = consolidatableEpisodes(events, episodes, now);
    await appendEpisodes(newEpisodes);
    episodes = [...episodes, ...newEpisodes];
    const resolvedIds = new Set(newEpisodes.map((episode) => episode.incidentId).filter(Boolean));
    working = working.filter((trace) => !trace.incidentId || !resolvedIds.has(trace.incidentId));
    protocols = protocolState(protocols, "consolidate", now);
  } catch (error) {
    protocols = protocolState(protocols, "consolidate", now, error);
  }

  // STM is intentionally tiny. A trace that loses this ranking has either been
  // consolidated above or remains derivable from the append-only event log.
  working = rankTraces(working).slice(0, STM_CAP);
  protocols = protocolState(protocols, "evict", now);
  await writeWorkingMemory(working, protocols, now.toISOString());

  const view = {
    working,
    episodes: rankTraces(episodes.map((trace) => decayTrace(trace, now))).slice(0, 200),
    longTerm: rankTraces(longTerm.map((trace) => decayTrace(trace, now))),
    protocols,
  };
  return { ...view, activityByNode: activityFor(view, events, now) };
}

export function recalledEpisodes(view: MemoryView, signature: string): MemoryTrace[] {
  return view.episodes.filter((episode) => episode.signature === signature).slice(0, 3);
}

export function isAbstractDue(protocols: MemorySnapshot["protocols"], now = new Date()): boolean {
  const last = protocols.abstract?.lastRunAt;
  return !last || now.getTime() - Date.parse(last) >= HOUR_MS;
}

export interface MemoryAbstraction {
  kind: "fact" | "procedure";
  headline: string;
  summary: string;
  sourceEventIds: string[];
}

export type MemoryAbstractor = (episodes: readonly MemoryTrace[]) => Promise<MemoryAbstraction | null>;

function abstractionCandidates(snapshot: MemorySnapshot): MemoryTrace[][] {
  const existing = new Set(snapshot.longTerm.map((trace) => trace.signature));
  const groups = new Map<string, MemoryTrace[]>();
  for (const episode of snapshot.episodes) {
    const group = groups.get(episode.signature) ?? [];
    group.push(episode);
    groups.set(episode.signature, group);
  }
  return [...groups]
    .filter(([signature, episodes]) => {
      if (existing.has(signature) || episodes.length < 3) return false;
      const times = episodes.map((episode) => Date.parse(episode.openedAt ?? episode.createdAt));
      return Math.max(...times) - Math.min(...times) > 24 * HOUR_MS;
    })
    .map(([, episodes]) => episodes);
}

/**
 * Rare, citation-checked model write. The caller supplies the model boundary;
 * this function owns the arithmetic eligibility and rejects any claim that
 * points outside the episodes actually supplied to it.
 */
export async function abstractLongTerm(abstractor: MemoryAbstractor, now = new Date()): Promise<boolean> {
  const snapshot = await readMemory();
  if (!isAbstractDue(snapshot.protocols, now)) return false;

  const protocols = protocolState(snapshot.protocols, "abstract", now);
  const candidates = abstractionCandidates(snapshot);
  if (candidates.length === 0) {
    await writeWorkingMemory(snapshot.working, protocols, now.toISOString());
    return false;
  }

  try {
    const episodes = candidates[0]!;
    const abstract = await abstractor(episodes);
    if (!abstract || !abstract.headline.trim() || !abstract.summary.trim()) {
      await writeWorkingMemory(snapshot.working, protocols, now.toISOString());
      return false;
    }
    const validIds = new Set(episodes.flatMap((episode) => episode.sourceEventIds));
    if (!abstract.sourceEventIds.length || !abstract.sourceEventIds.every((id) => validIds.has(id))) {
      protocols.abstract = { ...protocols.abstract, lastError: "abstraction cited an event outside its source episodes" };
      await writeWorkingMemory(snapshot.working, protocols, now.toISOString());
      return false;
    }
    const signature = episodes[0]!.signature;
    const trace: MemoryTrace = {
      id: `ltm-${signature.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}-${abstract.kind}`,
      tier: "ltm",
      kind: abstract.kind,
      signature,
      strength: 0.6,
      hits: 0,
      lastHitAt: now.toISOString(),
      createdAt: now.toISOString(),
      confirmations: episodes.length,
      contradictions: 0,
      evidence: [],
      sourceEventIds: abstract.sourceEventIds,
      headline: abstract.headline.trim(),
      summary: abstract.summary.trim(),
      activity: 0,
    };
    await appendLongTerm([trace]);
    await writeWorkingMemory(snapshot.working, protocols, now.toISOString());
    return true;
  } catch (error) {
    protocols.abstract = { ...protocols.abstract, lastError: error instanceof Error ? error.message : String(error) };
    await writeWorkingMemory(snapshot.working, protocols, now.toISOString());
    return false;
  }
}
