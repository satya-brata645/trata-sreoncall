import { latestRun, readRun } from "@/lib/artifacts/read";

/**
 * The latest run, as JSON.
 *
 * This is both the initial fetch and the polling fallback, so it is the one
 * path that must work when nothing else does — no stream, no watcher, no
 * event source. It reads the disk on every request by design: the whole point
 * of writing runs as files is that a new one appears without a rebuild.
 */

// Reading the filesystem per request; a cached response would pin the
// dashboard to whichever run existed at build time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  const latest = latestRun();
  if (!latest) {
    return Response.json({ error: "no runs found. Run: npm run seed:artifacts" }, { status: 404 });
  }

  const document = readRun(latest.id);
  if (!document) {
    // The run was listed a moment ago, so this is a directory being rewritten
    // underneath us. 503 rather than 404: the client should retry, not give up.
    return Response.json({ error: `run "${latest.id}" is not readable` }, { status: 503 });
  }

  return Response.json(
    { runId: latest.id, asOf: latest.asOf, document },
    { headers: { "cache-control": "no-store" } },
  );
}
