import { buildBaseTables, profileDocument, withAliases } from "@disco/core/profile";
import type { Row } from "@disco/core/algebra";
import type { DashboardSpec } from "@disco/core/spec";
import type { DatasetProfile } from "@disco/core/types";

import type { RunDocument } from "./read";

/**
 * Binding a document to a spec, without touching the disk.
 *
 * This half is deliberately separate from `dashboard.ts`: that module opens
 * files, so importing it from a client component drags `node:fs` into the
 * browser bundle and the build fails. The `import type` above is what keeps
 * this file clean — it is erased before the bundler ever sees the module.
 */

export interface BoundRun {
  profile: DatasetProfile;
  /** Keyed by every id a block may bind to, aliases included. */
  base: Record<string, Row[]>;
  runId: string;
  /** The instant the run describes. Every relative window counts back from it. */
  asOf: string;
  document: RunDocument;
}

/**
 * Bind an already-loaded spec to a document.
 *
 * The client receives whole documents over the run stream and re-profiles them
 * in the browser, so a new run does not need a round trip through the server to
 * become renderable. Profiling is cheap relative to fetching the document, and
 * doing it client-side keeps the two paths — first paint and subsequent runs —
 * on exactly one code path.
 *
 * `spec` is taken and not read: it is here to state at the call site that the
 * spec is the thing that survives a new run. Recomposing instead would discard
 * every edit a reader had made, every few minutes.
 */
export function rebind(spec: DashboardSpec, document: RunDocument): BoundRun {
  const profile = profileDocument(document, `artifacts/runs/${document.run.id}/dashboard.json`, 0);
  // Aliases are applied at read time; the artifact stores each table once.
  const base = withAliases(buildBaseTables(document, profile, { aliases: false }), profile);
  return { profile, base, runId: document.run.id, asOf: document.run.asOf, document };
}
