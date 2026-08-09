"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RunDocument } from "./read";

/**
 * Subscribe to the latest run.
 *
 * Streams by default and polls when it cannot, which is the ordinary shape.
 * The part worth reading is the swap rule:
 *
 * **The run on screen is replaced only by a run that has been fetched and
 * parsed in full.** A failed fetch, a truncated document, a 503 from a
 * directory being rewritten — none of them clear state. Anything else means
 * the dashboard blanks whenever the producer is mid-write, which is precisely
 * when someone is most likely to be looking at it. An error is a line of
 * chrome next to stale-but-real numbers, never an empty screen.
 *
 * `import type` above is deliberate: `read.ts` imports `node:fs`, and the type
 * import is erased before the bundler ever sees the module.
 */

const LATEST_URL = "/api/runs/latest";
const STREAM_URL = "/api/runs/stream";

/** Slow on purpose: this is the fallback, and the stream is the fast path. */
const POLL_MS = 15_000;

export interface LatestRunState {
  run: RunDocument | null;
  runId: string | null;
  /** Set when the most recent attempt failed. `run` is untouched. */
  error: string | null;
  /** True while the event source is open. False means the poller is driving. */
  isStreaming: boolean;
}

interface LatestResponse {
  runId: string;
  asOf: string;
  document: RunDocument;
}

function isCompleteRun(payload: unknown): payload is LatestResponse {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as { runId?: unknown; document?: { run?: { id?: unknown } } };
  return typeof p.runId === "string" && typeof p.document?.run?.id === "string";
}

export function useLatestRun(pollMs: number = POLL_MS): LatestRunState {
  const [loaded, setLoaded] = useState<{ run: RunDocument | null; runId: string | null }>({
    run: null,
    runId: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // The current id is read inside long-lived callbacks. Holding it in a ref
  // rather than in the dependency list keeps the event source from being torn
  // down and re-established on every new run.
  const runIdRef = useRef<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(LATEST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`latest run unavailable (${res.status})`);

      // Parsing happens before anything touches state, so a truncated body
      // throws here and leaves the previous run standing.
      const payload: unknown = await res.json();
      if (!isCompleteRun(payload)) throw new Error("run document is incomplete");
      if (!aliveRef.current) return;

      setError(null);
      if (payload.runId === runIdRef.current) return;
      runIdRef.current = payload.runId;
      setLoaded({ run: payload.document, runId: payload.runId });
    } catch (e) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();

    let poll: number | undefined;
    const startPolling = () => {
      if (poll === undefined) poll = window.setInterval(() => void load(), pollMs);
    };
    const stopPolling = () => {
      if (poll !== undefined) window.clearInterval(poll);
      poll = undefined;
    };

    const source = new EventSource(STREAM_URL);

    source.addEventListener("open", () => {
      if (!aliveRef.current) return;
      setIsStreaming(true);
      // Belt and braces are waste here: the stream reports every new run.
      stopPolling();
    });

    source.addEventListener("run", () => {
      // The event carries an id, not a document; `load` decides whether the id
      // is new and does the fetching.
      void load();
    });

    source.addEventListener("error", () => {
      if (!aliveRef.current) return;
      // EventSource reconnects on its own, and `open` will stop the poller
      // again. Until then the poller is what keeps the dashboard current.
      setIsStreaming(false);
      startPolling();
    });

    return () => {
      aliveRef.current = false;
      stopPolling();
      source.close();
    };
  }, [load, pollMs]);

  return { run: loaded.run, runId: loaded.runId, error, isStreaming };
}
