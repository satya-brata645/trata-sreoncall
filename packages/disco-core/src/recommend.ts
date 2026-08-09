import type { FieldProfile, TableProfile } from "./types";
import type { Block, Derivation } from "./spec";
import { LIMITS, aggFor, formatFor, type MeasureFormat, type SafeAgg } from "./limits";

// Re-exported so existing importers keep working; the definitions live in
// limits.ts so the validator can share them without importing the solver.
export { LIMITS, aggFor, formatFor };
export type { MeasureFormat, SafeAgg };

/**
 * The recommender: a small constraint solver in the spirit of Draco.
 *
 * Hard constraints eliminate encodings that are wrong for the data — a pie of
 * 400 categories, a line over an unordered dimension. Soft constraints carry a
 * weighted cost, so what survives can be ranked rather than merely permitted.
 *
 * The agent does not have to take the top candidate. It has to pick from this
 * list and say why, which is the whole point: chart *form* is decided by rules
 * that can be audited and fixed, and the model spends its judgement on which
 * question the dashboard should answer.
 */

export interface Candidate {
  /** Derivations this block needs, in order. Ids are prefixed to stay unique. */
  derivations: Derivation[];
  block: Block;
  /** Higher is better. Starts at 100 and pays for every soft-constraint violation. */
  score: number;
  /** Human-readable trace of what the scoring did. */
  rationale: string[];
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "f";

const field = (t: TableProfile, name: string) => t.fields.find((f) => f.name === name);

/** Measures worth leading with: high-signal names first, then anything numeric. */
function rankMeasures(t: TableProfile): FieldProfile[] {
  const PRIORITY = /(revenue|mrr|arr|amount|total|sales|count|value|score|duration|latency|spend|cost)/i;
  return t.measures
    .map((m) => field(t, m)!)
    .filter(Boolean)
    .sort((a, b) => {
      const pa = PRIORITY.test(a.name) ? 1 : 0;
      const pb = PRIORITY.test(b.name) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      // Prefer complete columns; a measure that is half null makes a poor headline.
      return a.nullFraction - b.nullFraction;
    });
}

function rankDimensions(t: TableProfile): FieldProfile[] {
  return t.dimensions
    .map((d) => field(t, d)!)
    .filter(Boolean)
    .sort((a, b) => {
      // Mid-cardinality dimensions are the most informative to split by.
      const cost = (f: FieldProfile) => Math.abs(Math.log2(Math.max(f.distinct, 2)) - 3);
      return cost(a) - cost(b);
    });
}

/* -------------------------------------------------------------- *
 * Candidate generators
 * -------------------------------------------------------------- */

function kpiCandidates(t: TableProfile): Candidate[] {
  const out: Candidate[] = [];
  const measures = rankMeasures(t).slice(0, 4);
  const time = field(t, t.timeFields[0]);

  measures.forEach((m, i) => {
    const rationale: string[] = [];
    let score = 100 - i * 4;
    const id = `kpi_${slug(m.name)}`;
    const derivations: Derivation[] = [];

    // A KPI without a trend behind it is a number with no context. If there is a
    // time field, attach a sparkline and a previous-period comparison.
    let spark: { from: string; x: string; y: string } | undefined;
    if (time?.temporal) {
      const unit = time.temporal.spanDays > 900 ? "month" : time.temporal.spanDays > 120 ? "week" : "day";
      const sparkId = `${id}_spark`;
      derivations.push({
        op: "timeBucket",
        id: sparkId,
        from: t.id,
        field: time.name,
        unit,
        agg: { [m.name]: aggFor(m) },
        fillGaps: true,
      });
      spark = { from: sparkId, x: "bucket", y: m.name };
      rationale.push(`time field "${time.name}" present, so the tile carries a ${unit} sparkline and a period-over-period delta`);
    } else {
      score -= 12;
      rationale.push("no time field: the tile shows a bare total with no trend");
    }

    if (m.nullFraction > 0.2) {
      score -= Math.round(m.nullFraction * 30);
      rationale.push(`${Math.round(m.nullFraction * 100)}% of "${m.name}" is null, so the total understates reality`);
    }

    const inverse = /(churn|error|latency|cost|spend|failure|bounce|defect|incident)/i.test(m.name);
    if (inverse) rationale.push("name suggests lower is better, so the delta colouring is inverted");

    out.push({
      derivations,
      score,
      rationale,
      block: {
        kind: "kpi",
        id,
        span: 3,
        title: m.name,
        from: t.id,
        field: m.name,
        agg: aggFor(m),
        format: formatFor(m),
        compare: { mode: time ? "previous" : "none", inverse },
        spark,
        reason: rationale[0],
      },
    });
  });

  return out;
}

function timeseriesCandidates(t: TableProfile): Candidate[] {
  const time = field(t, t.timeFields[0]);
  if (!time?.temporal) return [];

  const measures = rankMeasures(t).slice(0, LIMITS.MAX_SERIES);
  if (measures.length === 0) return [];

  const rationale: string[] = [];
  let score = 100;

  // Bucket width follows the span, not the row count: a two-year daily series
  // drawn per-day is 730 unreadable ticks.
  const span = time.temporal.spanDays;
  const unit = span > 1_100 ? "quarter" : span > 400 ? "month" : span > 90 ? "week" : span > 3 ? "day" : "hour";
  rationale.push(`${Math.round(span)} days of data at ${time.temporal.granularity} granularity, bucketed to ${unit}`);

  const id = "trend_main";
  const bucketId = "trend_bucketed";
  const agg: Record<string, SafeAgg> = {};
  for (const m of measures) agg[m.name] = aggFor(m);

  const derivations: Derivation[] = [
    { op: "timeBucket", id: bucketId, from: t.id, field: time.name, unit, agg, fillGaps: true },
  ];

  let from = bucketId;
  const estimatedBuckets = estimateBuckets(span, unit);
  if (estimatedBuckets > LIMITS.LINE_MAX_POINTS) {
    derivations.push({
      op: "downsample",
      id: "trend_downsampled",
      from: bucketId,
      x: "bucket",
      y: measures[0].name,
      points: LIMITS.LINE_MAX_POINTS,
    });
    from = "trend_downsampled";
    rationale.push(`~${estimatedBuckets} buckets exceeds the ${LIMITS.LINE_MAX_POINTS}-point line budget, so LTTB downsampling preserves the shape`);
  }

  if (!time.temporal.regular) {
    score -= 8;
    rationale.push("observations are irregularly spaced, so gaps are drawn as breaks rather than joined");
  }

  // Mixed magnitudes on one axis hide the smaller series entirely.
  const maxima = measures.map((m) => m.numeric?.max ?? 0).filter((v) => v > 0);
  const spread = maxima.length > 1 ? Math.max(...maxima) / Math.min(...maxima) : 1;
  const series = spread > 50 ? measures.slice(0, 1) : measures;
  if (spread > 50) {
    score -= 5;
    rationale.push(`measures differ by ${Math.round(spread)}x, so only "${measures[0].name}" is plotted; the rest would flatten to the axis`);
  }

  const skewed = (measures[0].numeric?.skew ?? 0) > 2.5;
  if (skewed) rationale.push("strong positive skew, so a log y-scale is offered");

  return [{
    derivations,
    score,
    rationale,
    block: {
      kind: "timeseries",
      id,
      span: 8,
      title: `${series.map((m) => m.name).join(", ")} over time`,
      from,
      x: "bucket",
      y: series.map((m) => m.name),
      mark: series.length === 1 ? "area" : "line",
      stack: false,
      format: formatFor(series[0]),
      connectNulls: false,
      yScale: skewed ? "log" : "linear",
      reason: rationale[0],
    },
  }];
}

function estimateBuckets(spanDays: number, unit: string): number {
  switch (unit) {
    case "hour": return spanDays * 24;
    case "day": return spanDays;
    case "week": return spanDays / 7;
    case "month": return spanDays / 30;
    case "quarter": return spanDays / 91;
    default: return spanDays;
  }
}

function breakdownCandidates(t: TableProfile): Candidate[] {
  const out: Candidate[] = [];
  const dims = rankDimensions(t).slice(0, 3);
  const measure = rankMeasures(t)[0];

  for (const dim of dims) {
    const rationale: string[] = [];
    let score = 100;
    const base = `by_${slug(dim.name)}`;
    const metric = measure?.name ?? "count";

    const derivations: Derivation[] = [{
      op: "groupBy",
      id: `${base}_grouped`,
      from: t.id,
      by: [dim.name],
      agg: measure ? { [measure.name]: aggFor(measure) } : { [dim.name]: "count" },
    }];

    let from = `${base}_grouped`;
    const n = dim.distinct;

    // The core scale rule: cardinality decides the mark.
    if (n > LIMITS.BAR_MAX_CATEGORIES) {
      derivations.push({
        op: "topK",
        id: `${base}_top`,
        from,
        by: dim.name,
        metric,
        k: 12,
        other: true,
      });
      from = `${base}_top`;
      score -= 6;
      rationale.push(`${n} distinct values exceeds the ${LIMITS.BAR_MAX_CATEGORIES}-bar limit, so this is the top 12 with the tail rolled into "Other"`);
    } else {
      derivations.push({ op: "sort", id: `${base}_sorted`, from, by: metric, dir: "desc" });
      from = `${base}_sorted`;
      rationale.push(`${n} distinct values fits a bar chart directly`);
    }

    // Long labels are unreadable rotated; lay the bars on their side instead.
    const longLabels = (dim.string?.avgLength ?? 0) > 12 || n > 8;
    if (longLabels) rationale.push("labels are long or numerous, so bars run horizontally to keep them readable");

    out.push({
      derivations,
      score,
      rationale,
      block: {
        kind: "bar",
        id: `${base}_bar`,
        span: 6,
        title: `${measure?.name ?? "Rows"} by ${dim.name}`,
        from,
        x: dim.name,
        y: [metric],
        orientation: longLabels ? "horizontal" : "vertical",
        stack: false,
        format: formatFor(measure),
        reason: rationale[0],
      },
    });

    // A donut is only honest for a handful of parts that genuinely sum to a whole.
    if (n <= LIMITS.PIE_MAX_CATEGORIES && measure && (measure.numeric?.negatives ?? 0) === 0) {
      out.push({
        derivations: derivations.slice(0, 1),
        score: score - 10,
        rationale: [`only ${n} categories and no negative values, so parts-of-a-whole is legible as a donut`],
        block: {
          kind: "pie",
          id: `${base}_donut`,
          span: 4,
          title: `${measure.name} share by ${dim.name}`,
          from: `${base}_grouped`,
          category: dim.name,
          value: measure.name,
          donut: true,
          format: formatFor(measure),
          reason: `${n} categories is within the ${LIMITS.PIE_MAX_CATEGORIES}-slice readability limit`,
        },
      });
    }
  }

  return out;
}

function distributionCandidates(t: TableProfile): Candidate[] {
  const measures = rankMeasures(t);
  const out: Candidate[] = [];

  for (const m of measures.slice(0, 2)) {
    // A distribution is only interesting when the values actually vary.
    if (m.distinct < 8) continue;
    const skew = Math.abs(m.numeric?.skew ?? 0);
    const rationale = [
      `"${m.name}" has ${m.distinct} distinct values${skew > 2 ? ` and a skew of ${skew.toFixed(1)}, so the mean alone is misleading` : ""}`,
    ];
    const id = `dist_${slug(m.name)}`;
    out.push({
      derivations: [{ op: "bin", id: `${id}_binned`, from: t.id, field: m.name, bins: 24 }],
      score: 78 + (skew > 2 ? 10 : 0),
      rationale,
      block: {
        kind: "histogram",
        id,
        span: 6,
        title: `Distribution of ${m.name}`,
        from: `${id}_binned`,
        x: "bin",
        y: "count",
        format: "compact",
        reason: rationale[0],
      },
    });
  }

  // Two independent measures invite a correlation view.
  if (measures.length >= 2 && t.rowCount <= 5_000) {
    const [a, b] = measures;
    const colorBy = rankDimensions(t).find((d) => d.distinct <= LIMITS.MAX_SERIES);
    out.push({
      derivations: [],
      score: 70,
      rationale: [`two independent measures over ${t.rowCount} rows, small enough to plot every point`],
      block: {
        kind: "scatter",
        id: `corr_${slug(a.name)}_${slug(b.name)}`,
        span: 6,
        title: `${a.name} vs ${b.name}`,
        from: t.id,
        x: a.name,
        y: b.name,
        colorBy: colorBy?.name,
        xScale: Math.abs(a.numeric?.skew ?? 0) > 2.5 ? "log" : "linear",
        yScale: Math.abs(b.numeric?.skew ?? 0) > 2.5 ? "log" : "linear",
        reason: "point-level relationship between the two leading measures",
      },
    });
  }

  return out;
}

function tableCandidate(t: TableProfile): Candidate {
  // Ids and long text are useless as axes but are exactly what you want in a row.
  const columns = t.fields
    .filter((f) => f.role !== "ignore" || f.semantic === "text")
    .slice(0, 12)
    .map((f) => ({
      field: f.name,
      label: f.name,
      format: f.role === "measure" ? formatFor(f) : undefined,
      align: (f.role === "measure" ? "right" : "left") as "left" | "right",
    }));

  const virtualize = t.rowCount > LIMITS.TABLE_VIRTUALIZE_ABOVE;

  return {
    derivations: [],
    score: 60,
    rationale: [
      `${t.rowCount} rows${virtualize ? `, above the ${LIMITS.TABLE_VIRTUALIZE_ABOVE}-row limit, so rows are windowed` : ""}`,
    ],
    block: {
      kind: "table",
      id: "detail_table",
      span: 12,
      title: "Detail",
      from: t.id,
      columns,
      pageSize: 25,
      virtualize,
      reason: "row-level detail behind the aggregates above",
    },
  };
}

/**
 * All viable blocks for a table, best first. The composer reads this list and
 * picks a coherent subset; it is not obliged to use everything.
 */
export function recommend(t: TableProfile): Candidate[] {
  return [
    ...kpiCandidates(t),
    ...timeseriesCandidates(t),
    ...breakdownCandidates(t),
    ...distributionCandidates(t),
    tableCandidate(t),
  ].sort((a, b) => b.score - a.score);
}

/** Small datasets go to the browser whole so filters stay live; big ones get pre-aggregated. */
export function chooseMode(rowCount: number): "client" | "server" {
  return rowCount <= LIMITS.CLIENT_MODE_MAX_ROWS ? "client" : "server";
}
