"use client";

/**
 * What the SRE agent has reported, brought to the surfaces that draw it.
 *
 * Polls rather than subscribes, on the same 15s beat as the chat and for the
 * same reason: events arrive from a process, not from this tab, and one small
 * GET beats a connection to keep alive.
 *
 * `hasLiveData` is the honest half of this. With an empty `.data` the apps fall
 * back to their fixtures, which is the demo's backstory and worth keeping — but
 * the caller has to be able to tell the difference, because "this is a picture"
 * and "this is what happened" must not look identical.
 */

import { useEffect, useMemo, useState } from "react";

import {
  deriveHypotheses,
  deriveIncident,
  deriveWorkingMemory,
  type DerivedHypothesis,
  type DerivedIncident,
  type DerivedMemoryEntry,
} from "@/lib/agent/brain-view";
import type { SreEvent } from "@/lib/agent/events";

const POLL_MS = 15_000;

export interface AgentActivity {
  events: SreEvent[];
  incident: DerivedIncident | null;
  hypotheses: DerivedHypothesis[];
  workingMemory: DerivedMemoryEntry[];
  hasLiveData: boolean;
}

export function useAgentActivity(): AgentActivity {
  const [events, setEvents] = useState<SreEvent[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/events");
        if (!response.ok) return;
        const body = (await response.json()) as { events?: SreEvent[] };
        if (cancelled || !Array.isArray(body.events)) return;
        // The route answers newest-first because that is what a feed wants;
        // every derivation here reasons forward through time, so flip it once
        // rather than in each of them.
        setEvents([...body.events].reverse());
      } catch {
        // The next tick retries.
      }
    }

    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return useMemo(
    () => ({
      events,
      incident: deriveIncident(events),
      hypotheses: deriveHypotheses(events),
      workingMemory: deriveWorkingMemory(events),
      hasLiveData: events.length > 0,
    }),
    [events],
  );
}
