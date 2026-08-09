import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading runs off disk.
 *
 * A run is an **immutable directory**: `artifacts/runs/<runId>/dashboard.json`
 * plus a small `meta.json`. Nothing is ever edited in place, so a reader never
 * has to reason about a document changing under it — it either sees the whole
 * run or it does not see the run at all.
 *
 * That "or not at all" is the entire reason this file is more than a
 * `readFileSync`. A producer writes the directory, then the document, and the
 * gap between those two is real: for a few milliseconds there is a run
 * directory on disk holding a truncated JSON file. Listing it would hand the
 * dashboard a half-parsed document, and the failure mode is not an error but a
 * screen of blanks. So the gate is the parse itself — a run exists once its
 * `dashboard.json` parses, and not one moment earlier.
 */

/* ------------------------------------------------------------------ *
 * The artifact contract
 * ------------------------------------------------------------------ */

/**
 * The run header. Every value here is a function of the producer's inputs —
 * `asOf` is passed in, never read from the clock — so re-running the same
 * producer with the same arguments rewrites a byte-identical directory.
 */
export interface RunHeader {
  id: string;
  /** ISO instant the window ends at. The document describes the estate *then*. */
  asOf: string;
  windowDays: number;
  /** Equal to `asOf` by construction; see the note in `seed-artifacts.ts`. */
  producedAt: string;
}

export interface MetricRow {
  id: string;
  label: string;
  value: number;
  unit: string;
  /** Percent change against the previous window of the same length; null when undefined. */
  delta: number | null;
  /** True when a fall is the good direction. Wrong here paints a fire green. */
  inverse: boolean;
  breach: boolean;
  /** The denominator, stated. */
  basis: string;
  meaning: string;
}

/**
 * Sparklines in long form, one row per point.
 *
 * A `number[]` nested inside a metric row is not a table: the profiler
 * flattens an array of scalars to a joined string, so the points would arrive
 * as `"12, 19, 7"` and nothing could plot them. Long form costs a few hundred
 * rows and makes every point a first-class value.
 */
export interface SparkRow {
  metric_id: string;
  /** ISO instant the daily bucket ends at. */
  t: string;
  v: number;
}

export interface PipelineRow {
  /** Stage position. The pipeline's meaning is its order, so it is data, not layout. */
  order: number;
  stage: string;
  count: number;
  /** Items that left the pipeline at this stage. */
  attrition: number;
  attrition_reason: string;
  /** Median minutes spent in this stage; null where the stage has no duration. */
  median_min: number | null;
  detail: string;
}

export interface AttentionRow {
  id: string;
  /** breach | risk | stale | noise. */
  severity: string;
  title: string;
  detail: string;
  /** Sort key. Higher is more urgent. */
  urgency: number;
  meta: string;
}

/** Six normalised axes, 0-100 and higher-is-better on every one. */
export interface ServiceAxisRow {
  service: string;
  Availability: number;
  Latency: number;
  Errors: number;
  Headroom: number;
  "Change safety": number;
  "Budget left": number;
}

export interface IncidentRow {
  id: string;
  title: string;
  service: string;
  severity: string;
  state: string;
  started_at: string;
  detect_min: number;
  ack_min: number;
  mitigate_min: number;
  rca_min: number | null;
  root_cause: string;
  alert_count: number;
  auto_remediated: boolean;
  escalated: boolean;
  responder: string;
  repeat: boolean;
  postmortem: boolean;
}

export interface ServiceRow {
  service: string;
  availability: number;
  slo: number;
  budget_burn: number;
  p95_latency_ms: number;
  error_rate_pct: number;
  saturation_pct: number;
  change_failure_pct: number;
  incidents: number;
}

export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  signals: number;
  alerts: number;
  noise: number;
  healthy: boolean;
}

export interface AlertRow {
  t: string;
  alerts: number;
  noise: number;
  incidents: number;
}

export interface CauseRow {
  cause: string;
  count: number;
}

export interface SeverityRow {
  severity: string;
  count: number;
  mttr: number;
  p90: number;
}

export interface HeatRow {
  day: string;
  /** Start of a three-hour band, UTC. 24 columns is unreadable in a card; 8 is legible. */
  hour: number;
  count: number;
}

/**
 * One run document.
 *
 * Every key but `run` holds an array of objects, which is what makes this file
 * profileable: `profileDocument` turns each one into a named table, and blocks
 * bind to those names. The producer must therefore keep to twelve tables —
 * `MAX_TABLES` in the profiler — or the smallest one is silently dropped.
 */
export interface RunDocument {
  run: RunHeader;
  metrics: MetricRow[];
  metric_spark: SparkRow[];
  pipeline: PipelineRow[];
  attention: AttentionRow[];
  service_axes: ServiceAxisRow[];
  incidents: IncidentRow[];
  services: ServiceRow[];
  sources: SourceRow[];
  alert_series: AlertRow[];
  cause_mix: CauseRow[];
  severity_mix: SeverityRow[];
  incident_heat: HeatRow[];
}

/** What `meta.json` carries: the header plus per-table row counts, for operators. */
export interface RunMeta extends RunHeader {
  seed: number;
  generator: string;
  tables: Record<string, number>;
}

export type RunSummary = RunHeader;

/* ------------------------------------------------------------------ *
 * Locating runs
 * ------------------------------------------------------------------ */

/** Relative to the repo root, matching the CLI's `ROOT`-relative writes. */
export const RUNS_DIR = join(process.cwd(), "artifacts", "runs");

export const DASHBOARD_FILE = "dashboard.json";
export const META_FILE = "meta.json";

/**
 * A run id must be a single path segment.
 *
 * `readRun` is reachable from a query string, and `join(dir, "../../etc")`
 * resolves happily. Validating the shape is cheaper than sandboxing the path.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Parsed headers, keyed by path and invalidated by mtime+size.
 *
 * The SSE watcher calls `latestRun()` on every filesystem event and the poller
 * calls it every fifteen seconds; re-parsing a 700-row document each time is
 * pure waste, and the completeness gate *requires* a parse. Caching on
 * (mtime, size) keeps the gate honest — an edited file has a new stamp — while
 * making the steady state a single `stat`.
 */
const headerCache = new Map<string, { stamp: string; header: RunHeader | null }>();

function isHeader(value: unknown): value is RunHeader {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  return typeof h.id === "string" && typeof h.asOf === "string" && typeof h.windowDays === "number";
}

/**
 * The completeness gate: a run exists only once its document parses *and*
 * carries a header. Returns null for anything else — a truncated write, a
 * directory with no document, a document whose `run` block is missing.
 */
function headerOf(dir: string, id: string): RunHeader | null {
  const path = join(dir, id, DASHBOARD_FILE);

  let stamp: string;
  try {
    const s = statSync(path);
    stamp = `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }

  const cached = headerCache.get(path);
  if (cached && cached.stamp === stamp) return cached.header;

  let header: RunHeader | null = null;
  try {
    const doc: unknown = JSON.parse(readFileSync(path, "utf8"));
    const run = (doc as { run?: unknown }).run;
    if (isHeader(run)) {
      // The directory name is authoritative: it is what the reader asked for
      // and what every other id in the system refers to.
      header = { ...run, id };
    }
  } catch {
    header = null;
  }

  headerCache.set(path, { stamp, header });
  return header;
}

/**
 * Every complete run, newest first.
 *
 * Sorting is a plain byte comparison of the id, deliberately, and it is
 * correct because ids are ISO-derived: `2026-08-09T11-00-00-000Z` is
 * fixed-width, big-endian and digits-only apart from separators that sit in
 * the same column of every id, so lexical order *is* chronological order.
 *
 * `localeCompare` would also look right and would be a bug — it reads the
 * runtime's locale, and Node and Chrome need not agree. That is the same class
 * of mistake that put Indian digit grouping on a server-rendered number and
 * desynced hydration for every figure on the page.
 */
export function listRuns(dir: string = RUNS_DIR): RunSummary[] {
  if (!existsSync(dir)) return [];

  const out: RunSummary[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !RUN_ID.test(entry.name)) continue;
    const header = headerOf(dir, entry.name);
    if (header) out.push(header);
  }

  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function latestRun(dir: string = RUNS_DIR): RunSummary | null {
  return listRuns(dir)[0] ?? null;
}

/** The full document for one run, or null if it is absent or incomplete. */
export function readRun(id: string, dir: string = RUNS_DIR): RunDocument | null {
  if (!RUN_ID.test(id)) return null;
  const path = join(dir, id, DASHBOARD_FILE);
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as RunDocument;
    // Same gate as the listing: a document without a header is a partial write.
    return isHeader(doc.run) ? doc : null;
  } catch {
    return null;
  }
}

export function readRunMeta(id: string, dir: string = RUNS_DIR): RunMeta | null {
  if (!RUN_ID.test(id)) return null;
  const path = join(dir, id, META_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RunMeta;
  } catch {
    return null;
  }
}

/** Create the runs directory if it is missing, so a watcher has something to watch. */
export function ensureRunsDir(dir: string = RUNS_DIR): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}
