#!/usr/bin/env tsx
/**
 * disco seed:artifacts — write one immutable run.
 *
 *   npm run seed:artifacts -- [--window 30] [--seed 123] [--asOf ISO] [--out DIR]
 *
 * A run is a directory the app only ever reads: `dashboard.json` (the whole
 * document) and `meta.json` (the header and row counts, for operators). The
 * document is one JSON object whose top-level array keys become named tables
 * through the ordinary profiler, so nothing downstream needs to know that an
 * SRE estate produced it.
 *
 * **The window is always the widest one.** Thirty days of hourly alerts is a
 * bigger file than a day of them, and it is still the right file: narrower
 * views are a filter over this document, produced by a time-range control at
 * read time. Writing a run per window would put the same estate on disk four
 * times and make "last 7 days" and "last 30 days" two artifacts that can
 * disagree with each other.
 *
 * This is the only place in the repo that couples to `lib/sre/generate.ts`,
 * and that module has no other consumer — the app reads the run it produces,
 * never the generator.
 */
import {
  buildAttention,
  buildPipeline,
  causeBreakdown,
  computeMetrics,
  generateSnapshot,
  incidentHeatmap,
  radarAxes,
  severityBreakdown,
} from "../lib/sre/generate";
import type {
  AlertRow,
  AttentionRow,
  CauseRow,
  HeatRow,
  IncidentRow,
  MetricRow,
  PipelineRow,
  RunDocument,
  RunMeta,
  ServiceAxisRow,
  ServiceRow,
  SeverityRow,
  SourceRow,
  SparkRow,
} from "../lib/artifacts/read";
import { pathToFileURL } from "node:url";

import { n } from "@disco/core/format";
import { die, writeJson } from "./disco-cli";

const DAY = 86_400_000;

/** Where runs live, relative to the repo root. */
const DEFAULT_OUT = "artifacts/runs";

export interface SeedOptions {
  /** ISO instant the window ends at. Everything in the document derives from it. */
  asOf: string;
  windowDays: number;
  seed: number;
}

/**
 * A run id, derived from `asOf` alone.
 *
 * Never from `Date.now()`: an id that reads the clock makes every run unique
 * even when its contents are identical, which turns "did anything actually
 * change?" into an unanswerable question and makes the output impossible to
 * diff. Deriving it from `asOf` means re-running the same arguments rewrites
 * the same directory with the same bytes — the reproducibility guarantee is
 * visible in the filename.
 *
 * The separators are replaced rather than stripped so the id stays fixed-width
 * and big-endian, which is what lets `listRuns` sort chronologically with a
 * byte comparison.
 */
export function runIdFromAsOf(asOf: string): string {
  return new Date(asOf).toISOString().replace(/[:.]/g, "-");
}

/**
 * Rounded to three decimals throughout.
 *
 * A median of 28.333333333333332 is not more accurate than 28.333, it is only
 * longer, and printing twelve significant figures claims a precision the
 * generator does not have. It also keeps the file diffable.
 */
const r3 = (v: number): number => (Number.isFinite(v) ? Number(v.toFixed(3)) : 0);

/**
 * Build the whole document from `(asOf, windowDays, seed)` and nothing else.
 *
 * Exported so a test can call it twice and compare bytes. If this function
 * ever reads the clock or `Math.random`, that test is the thing that notices.
 */
export function buildRunDocument({ asOf, windowDays, seed }: SeedOptions): RunDocument {
  const snap = generateSnapshot(asOf, windowDays, seed);
  const asOfMs = Date.parse(snap.asOf);

  const metricsIn = computeMetrics(snap);

  const metrics: MetricRow[] = metricsIn.map((m) => ({
    id: m.id,
    label: m.label,
    value: r3(m.value),
    unit: m.unit,
    delta: m.delta === null || !Number.isFinite(m.delta) ? null : r3(m.delta),
    inverse: m.inverse,
    breach: m.breach === true,
    basis: m.basis,
    meaning: m.meaning,
  }));

  // Sparklines come back oldest-first with one point per day, the last bucket
  // ending at asOf. Reconstructing the timestamp here rather than shipping a
  // bare index means the points can be plotted against a real axis.
  const metric_spark: SparkRow[] = metricsIn.flatMap((m) =>
    (m.spark ?? []).map((v, i) => ({
      metric_id: m.id,
      t: new Date(asOfMs - (m.spark!.length - 1 - i) * DAY).toISOString(),
      v: r3(v),
    })),
  );

  const pipeline: PipelineRow[] = buildPipeline(snap).map((s, i) => ({
    order: i,
    stage: s.label,
    count: s.count,
    // Flattened rather than nested: `attrition.count` would still profile, but
    // a block binding to a dotted field cannot be told apart from a block
    // binding to a field literally named "attrition.count".
    attrition: s.attrition?.count ?? 0,
    attrition_reason: s.attrition?.reason ?? "",
    median_min: s.medianMin ?? null,
    detail: s.detail,
  }));

  const attention: AttentionRow[] = buildAttention(snap).map((a) => ({
    id: a.id,
    severity: a.kind,
    title: a.title,
    detail: a.detail,
    urgency: r3(a.urgency),
    meta: a.meta,
  }));

  const service_axes: ServiceAxisRow[] = radarAxes(snap).map((a) => ({
    service: a.service,
    Availability: a.Availability,
    Latency: a.Latency,
    Errors: a.Errors,
    Headroom: a.Headroom,
    "Change safety": a["Change safety"],
    "Budget left": a["Budget left"],
  }));

  // snake_case across every table, including the ones that pass straight
  // through. A document that mixes `startedAt` with `attrition_reason` makes
  // the composer guess which convention a given table follows.
  const incidents: IncidentRow[] = snap.incidents.map((i) => ({
    id: i.id,
    title: i.title,
    service: i.service,
    severity: i.severity,
    state: i.state,
    started_at: i.startedAt,
    detect_min: i.detectMin,
    ack_min: i.ackMin,
    mitigate_min: i.mitigateMin,
    rca_min: i.rcaMin,
    root_cause: i.rootCause,
    alert_count: i.alertCount,
    auto_remediated: i.autoRemediated,
    escalated: i.escalated,
    responder: i.responder,
    repeat: i.repeat,
    postmortem: i.postmortem,
  }));

  const services: ServiceRow[] = snap.services.map((s) => ({
    service: s.service,
    availability: s.availability,
    slo: s.slo,
    budget_burn: s.budgetBurn,
    p95_latency_ms: s.p95LatencyMs,
    error_rate_pct: s.errorRatePct,
    saturation_pct: s.saturationPct,
    change_failure_pct: s.changeFailurePct,
    incidents: s.incidents,
  }));

  const sources: SourceRow[] = snap.sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    signals: s.signals,
    alerts: s.alerts,
    noise: s.noise,
    healthy: s.healthy,
  }));

  const alert_series: AlertRow[] = snap.alertSeries.map((a) => ({
    t: a.t,
    alerts: a.alerts,
    noise: a.noise,
    incidents: a.incidents,
  }));

  const cause_mix: CauseRow[] = causeBreakdown(snap).map((c) => ({ cause: c.cause, count: c.count }));

  const severity_mix: SeverityRow[] = severityBreakdown(snap).map((s) => ({
    severity: s.severity,
    count: s.count,
    mttr: s.mttr,
    p90: s.p90,
  }));

  const incident_heat: HeatRow[] = incidentHeatmap(snap);

  return {
    run: {
      id: runIdFromAsOf(asOf),
      asOf: snap.asOf,
      windowDays,
      // `producedAt` equals `asOf` on purpose. A wall-clock write time would be
      // the one field in the document that is not a function of the inputs,
      // and a single such field destroys byte-comparison — which is the only
      // cheap way to prove the producer is deterministic.
      producedAt: snap.asOf,
    },
    metrics,
    metric_spark,
    pipeline,
    attention,
    service_axes,
    incidents,
    services,
    sources,
    alert_series,
    cause_mix,
    severity_mix,
    incident_heat,
  };
}

/**
 * Exactly the profiler's `MAX_TABLES`. One more table and the smallest is
 * dropped without an error, so this is asserted rather than trusted.
 */
const MAX_TABLES = 12;

export function tableCounts(doc: RunDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (Array.isArray(value)) counts[key] = value.length;
  }
  return counts;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

interface Args {
  window: number;
  seed: number;
  asOf: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  // The clock is read once, here, at the edge — and only to choose a default.
  // Everything downstream receives `asOf` as an argument, which is what keeps
  // the generator reproducible and the artifact diffable.
  const args: Args = { window: 30, seed: 20260809, asOf: new Date().toISOString(), out: DEFAULT_OUT };

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) die(`missing value for ${flag}`);
    switch (flag) {
      case "--window":
        args.window = Number(value);
        if (!Number.isFinite(args.window) || args.window < 1) die(`--window must be a positive number, got "${value}"`);
        break;
      case "--seed":
        args.seed = Number(value);
        if (!Number.isFinite(args.seed)) die(`--seed must be a number, got "${value}"`);
        break;
      case "--asOf":
        if (Number.isNaN(Date.parse(value))) die(`--asOf must be an ISO instant, got "${value}"`);
        args.asOf = new Date(value).toISOString();
        break;
      case "--out":
        args.out = value;
        break;
      default:
        die(`unknown option "${flag}". usage: npm run seed:artifacts -- [--window 30] [--seed 123] [--asOf ISO] [--out DIR]`);
    }
  }

  return args;
}

function main(argv: string[]): void {
  const args = parseArgs(argv);
  const doc = buildRunDocument({ asOf: args.asOf, windowDays: args.window, seed: args.seed });
  const counts = tableCounts(doc);

  const names = Object.keys(counts);
  if (names.length > MAX_TABLES) {
    die(`document holds ${names.length} tables; the profiler keeps ${MAX_TABLES} and would drop the smallest silently.`);
  }
  const empty = names.filter((k) => counts[k] === 0);
  if (empty.length > 0) {
    // An empty array is not an array-of-objects, so the profiler never sees it
    // and any block bound to that name renders blank rather than erroring.
    process.stdout.write(`  warning: empty tables will not be profiled: ${empty.join(", ")}\n`);
  }

  const id = doc.run.id;
  const dir = `${args.out}/${id}`;

  const meta: RunMeta = {
    ...doc.run,
    seed: args.seed,
    generator: "disco-sre-seed@1",
    tables: counts,
  };

  // Document first, meta second. `listRuns` gates on `dashboard.json`, so
  // writing it last would be the one order that can expose a partial run.
  const path = writeJson(`${dir}/dashboard.json`, doc);
  writeJson(`${dir}/meta.json`, meta);

  const rows = names.reduce((a, k) => a + counts[k], 0);
  process.stdout.write(
    `\n${path}\n` +
      `  run ${id}  ·  asOf ${doc.run.asOf}  ·  ${args.window}d window  ·  seed ${args.seed}\n` +
      `  ${names.length} tables  ·  ${n(rows)} rows  ·  ` +
      `${n(doc.incidents.length)} incidents  ·  ${n(doc.metrics.length)} metrics  ·  ${n(doc.attention.length)} attention items\n\n`,
  );
}

// Importing this file must not write anything — the tests call
// `buildRunDocument` directly. `pathToFileURL` rather than string
// concatenation: a repo checked out under a path with a space produces a URL
// that never matches, and the guard would silently stop running the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
