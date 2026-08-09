"use client";

import { useEffect, useState } from "react";

const POLL_MS = 15_000;

export interface BrainMemoryState {
  activityByNode: Record<string, number>;
  hasLiveData: boolean;
}

const EMPTY: BrainMemoryState = { activityByNode: {}, hasLiveData: false };

/** The same cadence as agent activity, kept separate from the raw-event feed. */
export function useBrainMemory(): BrainMemoryState {
  const [memory, setMemory] = useState<BrainMemoryState>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/brain/memory");
        if (!response.ok) return;
        const body = (await response.json()) as {
          memory?: { activityByNode?: Record<string, number> };
          hasLiveData?: boolean;
        };
        if (cancelled || !body.memory?.activityByNode) return;
        setMemory({ activityByNode: body.memory.activityByNode, hasLiveData: body.hasLiveData === true });
      } catch {
        // Keep the last honest snapshot; the next polling tick retries.
      }
    }
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return memory;
}
