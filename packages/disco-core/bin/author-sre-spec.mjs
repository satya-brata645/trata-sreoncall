#!/usr/bin/env node
/**
 * Author the pinned SRE dashboard spec.
 *
 * This runs once, by hand, and its output is committed. The spec is *pinned*:
 * a new artifact run rebinds it rather than regenerating it, so a reader's
 * edits survive across runs and the encoding adapts through `resolve` instead
 * of being recomposed from scratch.
 *
 * Re-run it only to change the dashboard's design — not to pick up new data.
 *
 *   node packages/core/bin/author-sre-spec.mjs
 */
import { writeFileSync } from "node:fs";

// The six headline metrics. Deliberately six, not fourteen: the validator warns
// above six KPI tiles because a wall of numbers has no headline, and the full
// set is one table block away rather than lost.
// The producer only emits sparkline history for the duration metrics, so only
// those get a spark binding. A KPI with no trend behind it is a legitimate
// tile; a KPI bound to an empty spark frame is a validation error, and the gate
// catches it rather than rendering a blank strip.
const HEADLINE = [
  ["mttr",         "MTTR",               true],
  ["mtta",         "MTTA",               true],
  ["mttd",         "MTTD",               true],
  ["availability", "Availability",       false],
  ["burn",         "Worst budget burn",  false],
  ["open",         "Open incidents",     false],
];

const derivations = [];
const blocks = [];

// ---- 1. the pipeline: where work is lost -------------------------------
blocks.push({
  kind: "funnel", id: "pipeline_flow", span: 12,
  title: "Signal to postmortem",
  subtitle: "Where the work goes, and where it leaks — every stage against the one before it",
  from: "pipeline",
  stage: "stage", value: "count",
  attrition: "attrition", reasonField: "attrition_reason",
  duration: "median_min", detail: "detail",
  scale: "log", format: "compact",
  reason: "a funnel is the only form that shows attrition as loudly as throughput",
});

// ---- 2. headline metrics ------------------------------------------------
for (const [id, label, hasSpark] of HEADLINE) {
  derivations.push({ op: "filter", id: `m_${id}`, from: "metrics", where: [{ field: "id", op: "eq", value: id }] });
  if (hasSpark) {
    derivations.push({ op: "filter", id: `sp_${id}`, from: "metric_spark", where: [{ field: "metric_id", op: "eq", value: id }] });
  }

  blocks.push({
    kind: "kpi", id: `kpi_${id}`, span: 2, title: label,
    from: `m_${id}`, field: "value", agg: "first",
    // The producer already computed the label, unit, delta and breach state.
    // Reading them off the row means a threshold change upstream shows up here
    // without anyone editing the spec.
    labelField: "label", unitField: "unit", deltaField: "delta",
    inverseField: "inverse", breachField: "breach",
    basisField: "basis", meaningField: "meaning",
    ...(hasSpark ? { spark: { from: `sp_${id}`, x: "t", y: "v" } } : {}),
    compare: { mode: "none", inverse: false },
  });
}

// ---- 3. attention, beside the open queue --------------------------------
blocks.push({
  kind: "callout", id: "needs_attention", span: 7,
  title: "Needs your attention",
  from: "attention",
  titleField: "title", detailField: "detail",
  severityField: "severity", metaField: "meta", rankField: "urgency",
  limit: 8,
  emptyText: "Nothing needs attention — no open criticals, no budget breaches, no overdue root causes.",
  reason: "a ranked list, because at 3am the only question is what to look at first",
});

derivations.push({ op: "filter", id: "open_incidents", from: "incidents", where: [{ field: "state", op: "neq", value: "resolved" }] });
derivations.push({ op: "sort", id: "open_sorted", from: "open_incidents", by: "started_at", dir: "desc" });
blocks.push({
  kind: "table", id: "open_queue", span: 5,
  title: "Open queue",
  from: "open_sorted",
  columns: [
    { field: "severity", label: "Sev", align: "left" },
    { field: "title", label: "Incident", align: "left" },
    { field: "service", label: "Service", align: "left" },
    { field: "responder", label: "Owner", align: "left" },
  ],
  pageSize: 8, virtualize: false,
});

// ---- 4. trend -----------------------------------------------------------
derivations.push({
  op: "timeBucket", id: "alerts_6h", from: "alert_series", field: "t", unit: "hour",
  agg: { alerts: "sum", noise: "sum", incidents: "sum" }, fillGaps: true,
});
derivations.push({
  op: "derive", id: "alerts_split", from: "alerts_6h", as: "actionable",
  expr: { left: "alerts", op: "sub", right: "noise" },
});
blocks.push({
  kind: "timeseries", id: "alert_volume", span: 12,
  title: "Alert volume and incidents",
  subtitle: "The band below the line is noise — alerts that closed with no action",
  from: "alerts_split", x: "bucket",
  // Mixed marks on one axis: stacked areas carry volume, a line carries the
  // incident count. One mark for every series could not say this.
  y: [
    { field: "noise", mark: "area", stack: true },
    { field: "actionable", mark: "area", stack: true },
    { field: "incidents", mark: "line", stack: false },
  ],
  mark: "area", stack: true, format: "compact", connectNulls: false, yScale: "linear",
});

// ---- 5. distributions ---------------------------------------------------
// Seven causes against six validated colour slots. Rolling the tail into
// "Other" is what the hand-built page did, and expressing it here means the
// donut survives as designed instead of being repaired into a bar every run.
derivations.push({ op: "topK", id: "causes", from: "cause_mix", by: "cause", metric: "count", k: 5, other: true });
blocks.push({
  kind: "pie", id: "root_cause", span: 4, title: "Root cause",
  from: "causes", category: "cause", value: "count", donut: true, format: "compact",
});

derivations.push({ op: "derive", id: "budget_left", from: "services", as: "remaining", expr: { left: "budget_burn", op: "mul", right: -100 } });
derivations.push({ op: "derive", id: "budget_pct", from: "budget_left", as: "pct_left", expr: { left: "remaining", op: "add", right: 100 } });
blocks.push({
  kind: "radial", id: "error_budget", span: 4, title: "Error budget remaining",
  subtitle: "Budget left, not availability — 99.91% and 99.95% look identical on a dial",
  from: "budget_pct", category: "service", value: "pct_left",
  max: 100, warnAt: 25, critAt: 5, format: "percent",
});

blocks.push({
  kind: "radar", id: "service_health", span: 4, title: "Service health",
  subtitle: "Six axes scored against fixed targets, higher is better",
  from: "service_axes", entity: "service",
  axes: ["Availability", "Latency", "Errors", "Headroom", "Change safety", "Budget left"],
  series: ["checkout-api", "auth-service", "ledger-db"],
  max: 100,
});

blocks.push({
  kind: "bar", id: "mttr_by_sev", span: 6, title: "Time to restore by severity",
  subtitle: "Median against p90 — the typical page and the bad night",
  from: "severity_mix", x: "severity", y: ["mttr", "p90"],
  orientation: "horizontal", stack: false, format: "duration",
});

derivations.push({ op: "sort", id: "services_ranked", from: "services", by: "incidents", dir: "desc" });
blocks.push({
  kind: "bar", id: "by_service", span: 6, title: "Incidents by service",
  subtitle: "Amber and red mark services already spending error budget",
  from: "services_ranked", x: "service", y: ["incidents"],
  orientation: "horizontal", stack: false, format: "number",
  // Colour follows the entity's health, from a different column than the bar
  // length — so filtering the chart never repaints the survivors.
  colorBy: { field: "budget_burn", warnAt: 0.75, critAt: 1, inverse: false },
});

blocks.push({
  kind: "heatmap", id: "when", span: 6, title: "When incidents happen",
  subtitle: "UTC, three-hour bands — deploy windows show up as vertical stripes",
  from: "incident_heat", x: "hour", y: "day", value: "count", format: "number",
});

derivations.push({ op: "derive", id: "sources_split", from: "sources", as: "actionable", expr: { left: "alerts", op: "sub", right: "noise" } });
blocks.push({
  kind: "bar", id: "by_source", span: 6, title: "Alerts by source",
  subtitle: "Stacked so the noisiest connector is obvious at a glance",
  from: "sources_split", x: "name", y: ["actionable", "noise"],
  orientation: "vertical", stack: true, format: "compact",
});

// ---- 6. the full metric set, for anything not in the headline row -------
blocks.push({
  kind: "table", id: "all_metrics", span: 12, title: "All metrics",
  from: "metrics",
  columns: [
    { field: "label", label: "Metric", align: "left" },
    { field: "value", label: "Value", align: "right" },
    { field: "unit", label: "Unit", align: "left" },
    { field: "delta", label: "Δ vs prev", align: "right" },
    { field: "basis", label: "Basis", align: "left" },
  ],
  pageSize: 20, virtualize: false,
});

const spec = {
  $schema: "disco/v1",
  id: "sre_oncall",
  title: "SRE on-call",
  subtitle: "Signal to postmortem, end to end",
  intent: "What is on fire, where is work being lost, and how are we trending?",
  dataset: { source: "artifacts/runs/latest/dashboard.json", mode: "client", rowCount: 1048 },
  controls: [
    {
      kind: "timeRange", id: "range", label: "Window",
      table: "alert_series", field: "t",
      presets: ["last_24h", "last_7d", "last_14d", "last_30d", "all"],
      default: "last_14d",
      anchor: "data_max",
    },
    { kind: "dimension", id: "svc", label: "Service", table: "incidents", field: "service", mode: "single", values: [], default: [] },
    { kind: "dimension", id: "sev", label: "Severity", table: "incidents", field: "severity", mode: "single", values: [], default: [] },
  ],
  derivations,
  blocks,
  notes: [
    "Durations are medians with p90 alongside — incident times are long-tailed, and a mean MTTR sits above almost every incident that actually happened.",
    "Metrics are computed upstream by the producer and read from the artifact; everything derived at view time goes through the same algebra as the unfiltered figures.",
  ],
};

writeFileSync("artifacts/specs/sre-oncall.json", JSON.stringify(spec, null, 2) + "\n");
console.log(`blocks=${blocks.length} derivations=${derivations.length} controls=${spec.controls.length}`);
