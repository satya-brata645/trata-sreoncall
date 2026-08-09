import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSpec, type DashboardSpec } from "@disco/core/spec";

import { latestRun, readRun, RUNS_DIR } from "./read";
import { rebind, type BoundRun } from "./rebind";

/**
 * Bind a pinned spec to the newest run.
 *
 * The two halves are deliberately separate on disk: `artifacts/specs/<id>.json`
 * is authored and versioned, `artifacts/runs/<runId>/` is produced and
 * immutable. A new run rebinds the same spec — it does not regenerate one —
 * which is what lets a reader's edits survive a producer that drops a new
 * document every few minutes.
 */

const SPECS_DIR = join(process.cwd(), "artifacts", "specs");

export interface BoundDashboard extends BoundRun {
  spec: DashboardSpec;
}

export function loadSpec(specId: string): DashboardSpec | null {
  try {
    return parseSpec(JSON.parse(readFileSync(join(SPECS_DIR, `${specId}.json`), "utf8")));
  } catch {
    return null;
  }
}

/**
 * Load a spec bound to a specific run, or to the latest one.
 *
 * Returns `null` rather than throwing when either half is missing, because the
 * common case is not an error — it is a checkout where nobody has run
 * `npm run seed:artifacts` yet, and the page should say so.
 */
export function bindDashboard(specId: string, runId?: string, dir: string = RUNS_DIR): BoundDashboard | null {
  const spec = loadSpec(specId);
  if (!spec) return null;

  const summary = runId ? { id: runId } : latestRun(dir);
  if (!summary) return null;

  const document = readRun(summary.id, dir);
  if (!document) return null;

  // First paint goes through the same binder the run stream uses, so a
  // server-rendered dashboard and one that has swallowed three new runs cannot
  // have been built by different code.
  return { spec, ...rebind(spec, document) };
}

export { rebind, type BoundRun } from "./rebind";
