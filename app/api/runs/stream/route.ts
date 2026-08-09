import { watch, type FSWatcher } from "node:fs";

import { RUNS_DIR, ensureRunsDir, latestRun } from "@/lib/artifacts/read";

/**
 * Server-sent events: "a new run landed".
 *
 * The stream carries an identifier, never a document. Pushing the whole run
 * down the wire would double the transport (the polling fallback still has to
 * fetch it) and would make the event size grow with the estate; the client
 * fetches `/api/runs/latest` when it hears an id it has not seen.
 *
 * Three things make this survive contact with a real producer:
 *
 *   - **Debounce.** A producer writes a directory, then a document, then a
 *     meta file. `fs.watch` fires for each, and on macOS often twice per file.
 *     Emitting per event would push three or four times per run.
 *   - **The parse gate.** `latestRun()` only returns a run whose document
 *     parses, so the window between "directory created" and "document closed"
 *     produces no event at all. Without it the client fetches a truncated file
 *     and the dashboard blanks.
 *   - **Heartbeats.** Proxies drop an idle connection at 30-60s. A comment
 *     line every 25s is traffic without being data.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Long enough to cover a multi-file write, short enough to feel immediate. */
const DEBOUNCE_MS = 300;
const HEARTBEAT_MS = 25_000;

export function GET(request: Request): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let watcher: FSWatcher | null = null;
      let debounce: ReturnType<typeof setTimeout> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let lastEmitted: string | null = null;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client vanished between the abort signal and this write.
          cleanup();
        }
      };

      const publish = () => {
        const run = latestRun();
        // Only ever the newest id. A backfilled run with an older `asOf` is a
        // correction to history, not news, and pushing it would walk the
        // dashboard backwards in time while someone is reading it.
        if (!run || run.id === lastEmitted) return;
        lastEmitted = run.id;
        send(`event: run\ndata: ${JSON.stringify({ runId: run.id, asOf: run.asOf })}\n\n`);
      };

      function cleanup() {
        if (closed) return;
        closed = true;
        if (debounce) clearTimeout(debounce);
        if (heartbeat) clearInterval(heartbeat);
        watcher?.close();
        watcher = null;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime; nothing to unwind.
        }
      }

      request.signal.addEventListener("abort", cleanup);
      if (request.signal.aborted) {
        cleanup();
        return;
      }

      // Retry interval for the browser's own reconnect, stated once up front.
      send(`retry: 3000\n\n`);

      // The current run is emitted immediately so a client that subscribes
      // without fetching first still has something to render.
      publish();

      const schedule = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(publish, DEBOUNCE_MS);
      };

      if (ensureRunsDir()) {
        try {
          // Recursive: the document lands *inside* a new run directory, and a
          // flat watch on the parent never sees that write — it would fire
          // once for the mkdir, 300ms before the file exists, and then be
          // silent for the write that actually completes the run.
          watcher = watch(RUNS_DIR, { recursive: true }, schedule);
          watcher.on("error", () => {
            watcher?.close();
            watcher = null;
          });
        } catch {
          // Some filesystems refuse recursive watches. The heartbeat tick
          // below still notices new runs, and the client polls regardless.
          watcher = null;
        }
      }

      heartbeat = setInterval(() => {
        send(`: ping\n\n`);
        // Cheap backstop: if the watcher failed or missed an event, a run is
        // at worst one heartbeat late rather than invisible.
        publish();
      }, HEARTBEAT_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers proxied responses by default, which holds every event
      // until the buffer fills — the stream looks dead for minutes.
      "x-accel-buffering": "no",
    },
  });
}
