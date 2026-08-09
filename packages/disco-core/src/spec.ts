import { z } from "zod";

/**
 * Disco Spec v1 — the contract between the agent and the renderer.
 *
 * Two rules make this whole system trustworthy, and both are enforced here:
 *   1. Blocks BIND, they never carry data. Every block points at a frame id;
 *      the numbers come from the algebra, so the agent cannot invent one.
 *   2. The vocabulary is closed. A block kind the renderer does not know is a
 *      validation failure at generation time, not a blank card at runtime.
 */

const Id = z.string().regex(/^[a-z][a-z0-9_]*$/, "ids are lower_snake_case");

export const AggSchema = z.enum([
  "sum", "avg", "min", "max", "count", "countDistinct", "median", "p95", "first", "last",
]);
export type Agg = z.infer<typeof AggSchema>;

export const TimeUnitSchema = z.enum(["hour", "day", "week", "month", "quarter", "year"]);

export const ComparatorSchema = z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "contains", "isNull", "notNull"]);

export const PredicateSchema = z.object({
  field: z.string(),
  op: ComparatorSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()]))]).optional(),
});

/* ------------------------------------------------------------------ *
 * Derivations — the closed algebra. The agent composes these; it never
 * computes. Each one names its input by id, so they form a DAG.
 * ------------------------------------------------------------------ */

const DerivationBase = { id: Id, from: z.string(), label: z.string().optional() };

export const DerivationSchema = z.discriminatedUnion("op", [
  z.object({ ...DerivationBase, op: z.literal("filter"), where: z.array(PredicateSchema).min(1) }),

  z.object({
    ...DerivationBase,
    op: z.literal("groupBy"),
    by: z.array(z.string()).min(1),
    agg: z.record(z.string(), AggSchema),
  }),

  z.object({
    ...DerivationBase,
    op: z.literal("timeBucket"),
    field: z.string(),
    unit: TimeUnitSchema,
    agg: z.record(z.string(), AggSchema),
    /** Emit empty buckets so a gap in the data reads as a gap, not as a straight line. */
    fillGaps: z.boolean().default(true),
    by: z.array(z.string()).optional(),
  }),

  z.object({
    ...DerivationBase,
    op: z.literal("topK"),
    by: z.string(),
    metric: z.string(),
    k: z.number().int().min(1).max(100),
    /** Roll the tail into a single "Other" row instead of dropping it silently. */
    other: z.boolean().default(true),
  }),

  z.object({
    ...DerivationBase,
    op: z.literal("bin"),
    field: z.string(),
    bins: z.number().int().min(2).max(100).default(20),
  }),

  z.object({
    ...DerivationBase,
    op: z.literal("derive"),
    as: z.string(),
    /** Deliberately tiny: two operands and an operator. No expression language, no eval. */
    expr: z.object({
      left: z.string(),
      op: z.enum(["add", "sub", "mul", "div", "pctOf", "pctChange"]),
      right: z.union([z.string(), z.number()]),
    }),
  }),

  z.object({
    ...DerivationBase,
    op: z.literal("window"),
    field: z.string(),
    as: z.string(),
    fn: z.enum(["rollingAvg", "cumSum", "delta"]),
    size: z.number().int().min(2).max(365).default(7),
  }),

  z.object({ ...DerivationBase, op: z.literal("sort"), by: z.string(), dir: z.enum(["asc", "desc"]).default("desc") }),

  z.object({ ...DerivationBase, op: z.literal("limit"), n: z.number().int().min(1).max(100_000) }),

  z.object({
    ...DerivationBase,
    op: z.literal("downsample"),
    x: z.string(),
    y: z.string(),
    /** Largest-Triangle-Three-Buckets: keeps the visual shape, drops the point count. */
    points: z.number().int().min(50).max(5_000).default(500),
  }),
]);
export type Derivation = z.infer<typeof DerivationSchema>;

/* ------------------------------------------------------------------ *
 * Blocks — the component catalog.
 * ------------------------------------------------------------------ */

export const FormatSchema = z.enum(["number", "compact", "usd", "percent", "bytes", "ms", "duration"]);

const BlockBase = {
  id: Id,
  /** Grid columns out of 12. The renderer clamps this on small screens. */
  span: z.number().int().min(2).max(12).default(6),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  /** Why this component, in one line. Written by the composer, shown in the spec inspector. */
  reason: z.string().optional(),
};

export const BlockSchema = z.discriminatedUnion("kind", [
  z.object({
    ...BlockBase,
    kind: z.literal("kpi"),
    from: z.string(),
    field: z.string(),
    agg: AggSchema.default("sum"),
    format: FormatSchema.default("number"),
    compare: z.object({
      mode: z.enum(["previous", "target", "none"]).default("previous"),
      target: z.number().optional(),
      /** true when a fall is the good direction (churn, latency, cost). */
      inverse: z.boolean().default(false),
    }).optional(),
    spark: z.object({ from: z.string(), x: z.string(), y: z.string() }).optional(),
    /**
     * Read the tile's chrome from the row instead of the spec.
     *
     * When an upstream producer already computed a metric — its label, unit,
     * delta and whether it breaches — repeating those in the spec means two
     * places to update and a spec that goes stale the moment the producer
     * changes a threshold. These point at columns instead. All optional, so
     * every existing KPI is untouched.
     */
    labelField: z.string().optional(),
    unitField: z.string().optional(),
    deltaField: z.string().optional(),
    inverseField: z.string().optional(),
    breachField: z.string().optional(),
    basisField: z.string().optional(),
    meaningField: z.string().optional(),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("timeseries"),
    from: z.string(),
    x: z.string(),
    /**
     * Series, as bare field names or as `{ field, mark }`.
     *
     * A bare string inherits the block's `mark`, which is what almost every
     * chart wants. The object form exists because some charts genuinely mix
     * marks on one axis — an alert-volume chart draws stacked areas for volume
     * and a line for incident count, and forcing one enum across all series
     * made that chart inexpressible.
     */
    y: z.array(z.union([
      z.string(),
      z.object({
        field: z.string(),
        mark: z.enum(["line", "area", "bar"]).optional(),
        /** Overrides the block-level `stack` for this series alone. */
        stack: z.boolean().optional(),
      }),
    ])).min(1).max(8),
    mark: z.enum(["line", "area", "bar"]).default("line"),
    stack: z.boolean().default(false),
    format: FormatSchema.default("number"),
    /** Draw gaps as gaps. Only safe to disable when the profile says the series is regular. */
    connectNulls: z.boolean().default(false),
    yScale: z.enum(["linear", "log"]).default("linear"),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("bar"),
    from: z.string(),
    x: z.string(),
    y: z.array(z.string()).min(1).max(8),
    orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
    stack: z.boolean().default(false),
    format: FormatSchema.default("number"),
    /**
     * Colour each bar from a *second* field rather than by its rank.
     *
     * A chart of incidents-per-service is far more useful when the bars for
     * services already over their error budget are red — and that status lives
     * in a different column from the bar length. Colour follows the entity's
     * state, so filtering the chart never repaints the survivors.
     */
    colorBy: z.object({
      field: z.string(),
      warnAt: z.number(),
      critAt: z.number(),
      /** true when a LOW value is the bad one. */
      inverse: z.boolean().default(false),
    }).optional(),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("pie"),
    from: z.string(),
    category: z.string(),
    value: z.string(),
    donut: z.boolean().default(true),
    format: FormatSchema.default("number"),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("scatter"),
    from: z.string(),
    x: z.string(),
    y: z.string(),
    size: z.string().optional(),
    colorBy: z.string().optional(),
    xScale: z.enum(["linear", "log"]).default("linear"),
    yScale: z.enum(["linear", "log"]).default("linear"),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("histogram"),
    from: z.string(),
    x: z.string(),
    y: z.string().default("count"),
    format: FormatSchema.default("number"),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("heatmap"),
    from: z.string(),
    x: z.string(),
    y: z.string(),
    value: z.string(),
    format: FormatSchema.default("number"),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("table"),
    from: z.string(),
    columns: z.array(z.object({
      field: z.string(),
      label: z.string().optional(),
      format: FormatSchema.optional(),
      align: z.enum(["left", "right"]).optional(),
    })).min(1).max(30),
    pageSize: z.number().int().min(5).max(200).default(25),
    /** Windowed rendering. Required above ~2k rows; the validator enforces it. */
    virtualize: z.boolean().default(false),
  }),

  /*
   * The four kinds below exist because an existing kind could not express them
   * without lying about what it encodes. Each one's justification is in its
   * doc comment — "it looks nicer" is never sufficient, because every added
   * kind is another thing the agent can get wrong and the solver must size.
   */

  z.object({
    ...BlockBase,
    kind: z.literal("funnel"),
    from: z.string(),
    /** The stage label. Rows are drawn in table order, not sorted. */
    stage: z.string(),
    value: z.string(),
    /** How many items left the pipeline at this stage. */
    attrition: z.string().optional(),
    /**
     * The column holding why they left, in a few words.
     *
     * `reasonField`, not `reason`, because `BlockBase.reason` is the composer's
     * one-line rationale for the block. Both were `string | undefined`, so a
     * funnel declaring `reason` typechecked while silently overwriting its own
     * rationale — and the spec inspector rendered a column name as prose.
     */
    reasonField: z.string().optional(),
    /** Median minutes spent in this stage. */
    duration: z.string().optional(),
    /** Longer explanation, for the tooltip. */
    detail: z.string().optional(),
    /**
     * Log by default. A funnel whose first stage is millions and whose last is
     * tens renders every stage after the first as an invisible sliver on a
     * linear scale — the shape says "everything is lost immediately", which is
     * a claim about the data rather than about the scale.
     */
    scale: z.enum(["log", "linear"]).default("log"),
    format: FormatSchema.default("compact"),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("radar"),
    from: z.string(),
    /** The column naming each entity — one row per entity, wide format. */
    entity: z.string(),
    /**
     * The columns to draw as axes.
     *
     * No other block takes a *column list* as an encoding channel, which is
     * why this could not be a bar or a pie. Every axis must already be
     * normalised to a common 0..max, and oriented so higher is better —
     * otherwise a large shape means "good at some things, terrible at others"
     * and the silhouette carries no meaning at all.
     */
    axes: z.array(z.string()).min(3).max(8),
    /**
     * Which entities to draw. Capped at three: a radar compares every pair of
     * shapes at once, and the validated palette only clears the all-pairs
     * colour-separation floor for three slots.
     */
    series: z.array(z.string()).min(1).max(3),
    max: z.number().default(100),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("radial"),
    from: z.string(),
    category: z.string(),
    value: z.string(),
    /**
     * A gauge, not a share. `pie` encodes each slice as a fraction of a whole;
     * this encodes each arc as a magnitude against its own ceiling, which is
     * what "62% of the error budget remains" means and what a pie cannot say.
     */
    max: z.number().default(100),
    /** Value below which the arc turns amber, then red. */
    warnAt: z.number().optional(),
    critAt: z.number().optional(),
    format: FormatSchema.default("percent"),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("callout"),
    from: z.string(),
    title: z.string().optional(),
    /** The row's headline. Named `titleField` so it cannot collide with the block title. */
    titleField: z.string(),
    detailField: z.string().optional(),
    /**
     * Drives the icon, the ring and a spelled-out status word.
     *
     * A table could hold the same columns, but it would render them as a
     * uniform grid — and the whole point of this block is that the first item
     * must be unmissable at 3am. The word always accompanies the colour.
     */
    severityField: z.string(),
    metaField: z.string().optional(),
    /** Sorted descending. Absent means table order is already the ranking. */
    rankField: z.string().optional(),
    limit: z.number().int().min(1).max(20).default(8),
    /** Shown when there is nothing to report — and it should say so positively. */
    emptyText: z.string().default("Nothing needs attention."),
  }),

  z.object({
    ...BlockBase,
    kind: z.literal("text"),
    /** Narrative. Any figure quoted here must also appear in a bound block. */
    body: z.string().max(2_000),
    tone: z.enum(["neutral", "insight", "warning"]).default("neutral"),
  }),
]);
export type Block = z.infer<typeof BlockSchema>;
export type BlockKind = Block["kind"];

/** A series after normalisation: the object form, with defaults filled in. */
export interface Series {
  field: string;
  mark: "line" | "area" | "bar";
  stack: boolean;
}

/**
 * Normalise a timeseries block's `y` into one shape.
 *
 * `y` accepts bare field names because that is what nearly every chart wants,
 * and objects because a few genuinely mix marks. Every consumer — the renderer,
 * the validator, the layout hints — should see the same thing, so the union is
 * collapsed exactly once, here, rather than each caller re-deciding what a bare
 * string means.
 */
export function seriesOf(block: Extract<Block, { kind: "timeseries" }>): Series[] {
  return block.y.map((entry) =>
    typeof entry === "string"
      ? { field: entry, mark: block.mark, stack: block.stack }
      : { field: entry.field, mark: entry.mark ?? block.mark, stack: entry.stack ?? block.stack },
  );
}

/** Just the field names a timeseries reads, in order. */
export function seriesFields(block: Extract<Block, { kind: "timeseries" }>): string[] {
  return block.y.map((e) => (typeof e === "string" ? e : e.field));
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Controls — what the reader may change without editing the spec
 * ------------------------------------------------------------------ */

/**
 * Relative windows, never absolute dates.
 *
 * `{ from: "2026-01-01" }` is correct for exactly one day. A preset survives
 * the data growing underneath it, which is the entire point when an upstream
 * producer drops a new run every few minutes.
 */
export const RelativeRangeSchema = z.enum([
  "last_24h", "last_7d", "last_14d", "last_30d", "last_90d", "last_12m", "mtd", "qtd", "ytd", "all",
]);
export type RelativeRange = z.infer<typeof RelativeRangeSchema>;

export const ControlSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("timeRange"),
    id: Id,
    label: z.string().optional(),
    /** The table whose rows get filtered, and the temporal field to filter on. */
    table: z.string(),
    field: z.string(),
    presets: z.array(RelativeRangeSchema).min(1)
      .default(["last_24h", "last_7d", "last_30d", "all"]),
    default: RelativeRangeSchema.default("last_30d"),
    /**
     * What "now" means for a relative preset.
     *
     * `data_max` — the latest timestamp in the data. This is the default
     * because a batch producer is almost always behind the wall clock, and
     * anchoring to `now` blanks every block the moment it lags. "The last 30
     * days of data" is also what a reader assumes they are looking at.
     *
     * `now` — the wall clock, for genuinely live feeds.
     */
    anchor: z.enum(["data_max", "now"]).default("data_max"),
  }),

  z.object({
    kind: z.literal("dimension"),
    id: Id,
    label: z.string().optional(),
    table: z.string(),
    field: z.string(),
    mode: z.enum(["single", "multi"]).default("single"),
    /** Empty means "fill from the live profile", so new values appear on their own. */
    values: z.array(z.string()).default([]),
    default: z.array(z.string()).default([]),
  }),
]);
export type Control = z.infer<typeof ControlSchema>;

export const DashboardSpecSchema = z.object({
  $schema: z.literal("disco/v1"),
  id: Id,
  title: z.string().min(1).max(120),
  subtitle: z.string().max(240).optional(),
  /** The question this dashboard was generated to answer. */
  intent: z.string().max(500),
  dataset: z.object({
    source: z.string(),
    /** "client" ships rows and runs the algebra in the browser; "server" ships computed frames. */
    mode: z.enum(["client", "server"]),
    rowCount: z.number().int().nonnegative(),
  }),
  /** What the reader may narrow without editing anything. */
  controls: z.array(ControlSchema).max(8).default([]),
  derivations: z.array(DerivationSchema).max(40).default([]),
  blocks: z.array(BlockSchema).min(1).max(30),
  /** Caveats the reader needs: sampling, gaps, coverage, unit guesses. */
  notes: z.array(z.string()).default([]),
});
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

export function parseSpec(input: unknown): DashboardSpec {
  return DashboardSpecSchema.parse(input);
}
