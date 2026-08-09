import { LIMITS, aggFor } from "./limits";
import { fieldBindings, frameBindings } from "./bindings";
import { seriesFields, type Block, type DashboardSpec } from "./spec";
import type { Frame, Row } from "./algebra";
import type { DatasetProfile, FieldProfile } from "./types";

/**
 * The rule table.
 *
 * A rule measures the data once and emits three things from those same facts:
 * the message a human reads, the prose fix an agent applies, and — where the
 * violation is mechanically fixable — the patch operations that fix it.
 *
 * Before this existed the scale limits lived in two places and a repair layer
 * would have made three, each free to drift from the others. The worst version
 * of that drift is silent: the error says "use agg: last", the auto-repair sets
 * something else, and nobody notices because both are individually plausible.
 * Emitting all three from one `detect` makes the drift impossible rather than
 * unlikely — and the test that proves it just applies each repair and asserts
 * the violation is gone.
 *
 * `phase` exists because the validator is not a flat list: it stops after a
 * schema failure, stops again if structure is broken, and stops a third time if
 * the derivation graph will not execute. Running a binding check against frames
 * that could not be computed would report noise instead of the real problem.
 */

export type RuleId =
  | "spec.schema"
  | "derivation.duplicate_id"
  | "block.id_collision"
  | "block.unknown_frame"
  | "spec.pipeline_failed"
  | "block.empty_frame"
  | "block.missing_field"
  | "pie.too_many_categories"
  | "pie.negative_values"
  | "bar.too_many_categories"
  | "bar.too_many_series"
  | "timeseries.too_many_points"
  | "timeseries.too_many_series"
  | "timeseries.stack_single_series"
  | "timeseries.log_scale_nonpositive"
  | "table.needs_virtualization"
  | "scatter.overplot"
  | "kpi.sum_monotonic"
  | "kpi.sum_percent"
  | "kpi.sum_duration"
  | "spec.too_sparse"
  | "spec.too_many_kpis"
  | "spec.client_mode_too_many_rows";

/** Where in the sequence a rule runs. Order here is order on screen. */
export type Phase = "schema" | "structure" | "binding" | "perceptual" | "dashboard";

export interface Violation {
  ruleId: RuleId;
  /** Block or derivation id, or "$" for the spec itself. */
  where: string;
  /** Everything the message, the fix and the repair need. Measured once. */
  facts: Record<string, unknown>;
}

/**
 * A patch operation a repair emits.
 *
 * Deliberately structural rather than typed against `patch.ts`: rules must not
 * depend on the patch module, or the dependency runs rules → patch → validate →
 * rules. `patch.ts` narrows these on the way in.
 */
export interface RepairOp {
  op: string;
  [key: string]: unknown;
}

export interface Repair {
  ops: RepairOp[];
  /** Past tense, one line: "Donut became a bar chart." */
  note: string;
  /** True when the repair hides data — a truncated series, a rolled-up tail. */
  lossy: boolean;
}

export interface RuleContext {
  spec: DashboardSpec;
  frames: Map<string, Frame>;
  profile?: DatasetProfile;
  /** Frame ids that exist, base tables included. */
  frameIds: Set<string>;
  /** True when a control is narrowing the data — changes what "empty" means. */
  filtered: boolean;
  /** Deterministic id minting for derivations a repair introduces. */
  mintId(prefix: string): string;
  /**
   * False in server mode, where there are no base rows to re-run a pipeline
   * against. Repairs that rewrite derivations are unavailable there.
   */
  canRewriteDerivations: boolean;
}

export interface Rule {
  id: RuleId;
  level: "error" | "warning";
  phase: Phase;
  /** Which block kinds this applies to. "$" means the spec as a whole. */
  scope: Block["kind"][] | "$";
  detect(target: Block | DashboardSpec, ctx: RuleContext): Violation | null;
  message(v: Violation): string;
  fix(v: Violation): string | undefined;
  repair?(v: Violation, ctx: RuleContext): Repair | null;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const f = <T>(v: Violation, key: string): T => v.facts[key] as T;

function distinctCount(rows: Row[], key: string): number {
  const seen = new Set<string>();
  for (const r of rows) seen.add(String(r[key] ?? ""));
  return seen.size;
}

function profileField(ctx: RuleContext, name: string): FieldProfile | undefined {
  return ctx.profile?.tables.flatMap((t) => t.fields).find((x) => x.name === name);
}

/** The coarser bucket, for the "range grew" repair. */
const COARSER: Record<string, string> = {
  hour: "day",
  day: "week",
  week: "month",
  month: "quarter",
  quarter: "year",
};

const asBlock = (t: Block | DashboardSpec): Block => t as Block;
const asSpec = (t: Block | DashboardSpec): DashboardSpec => t as DashboardSpec;

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

export const RULES: Rule[] = [
  /* -- structure ------------------------------------------------- */

  {
    id: "derivation.duplicate_id",
    level: "error",
    phase: "structure",
    scope: "$",
    detect(target) {
      const spec = asSpec(target);
      const seen = new Set<string>();
      for (const d of spec.derivations) {
        if (seen.has(d.id)) return { ruleId: "derivation.duplicate_id", where: d.id, facts: { id: d.id } };
        seen.add(d.id);
      }
      return null;
    },
    message: (v) => `Duplicate derivation id "${f<string>(v, "id")}".`,
    fix: () => "Give every derivation a unique id.",
  },

  {
    id: "block.id_collision",
    level: "error",
    phase: "structure",
    scope: "$",
    detect(target) {
      const spec = asSpec(target);
      const ids = new Set(spec.derivations.map((d) => d.id));
      for (const b of spec.blocks) {
        if (ids.has(b.id)) return { ruleId: "block.id_collision", where: b.id, facts: { id: b.id } };
        ids.add(b.id);
      }
      return null;
    },
    message: (v) => `Block id "${f<string>(v, "id")}" collides with another id.`,
    fix: () => undefined,
  },

  {
    id: "block.unknown_frame",
    level: "error",
    phase: "structure",
    scope: "$",
    detect(target, ctx) {
      const spec = asSpec(target);
      for (const b of spec.blocks) {
        // Every binding site, not just `from` — a KPI's sparkline frame is a
        // binding that went unchecked until it caused a silent failure.
        for (const frame of frameBindings(b)) {
          if (!ctx.frameIds.has(frame)) {
            return {
              ruleId: "block.unknown_frame",
              where: b.id,
              facts: { frame, available: [...ctx.frameIds] },
            };
          }
        }
      }
      return null;
    },
    message: (v) => `Block binds to unknown frame "${f<string>(v, "frame")}".`,
    fix: (v) => `Bind to one of: ${f<string[]>(v, "available").join(", ")}.`,
  },

  /* -- binding --------------------------------------------------- */

  {
    id: "block.empty_frame",
    level: "error",
    phase: "binding",
    scope: ["kpi", "timeseries", "bar", "pie", "scatter", "histogram", "heatmap", "table"],
    detect(target, ctx) {
      const b = asBlock(target);
      // The first binding is the primary frame. Going through frameBindings
      // rather than reaching for `.from` keeps this working for any block kind,
      // including ones that bind more than one frame.
      const [primary] = frameBindings(b);
      if (!primary) return null;
      const frame = ctx.frames.get(primary);
      if (!frame || frame.rows.length > 0) return null;
      return { ruleId: "block.empty_frame", where: b.id, facts: { frame: primary, filtered: ctx.filtered } };
    },
    // An empty frame under an active filter is a user action, not a spec bug.
    // The level is contextual so a narrow filter does not read as breakage.
    message: (v) =>
      f<boolean>(v, "filtered")
        ? `Frame "${f<string>(v, "frame")}" has no rows under the current filters.`
        : `Frame "${f<string>(v, "frame")}" is empty, so this block would render blank.`,
    fix: () => "Loosen the filter, or drop the block.",
  },

  {
    id: "block.missing_field",
    level: "error",
    phase: "binding",
    scope: ["kpi", "timeseries", "bar", "pie", "scatter", "histogram", "heatmap", "table"],
    detect(target, ctx) {
      const b = asBlock(target);
      // Each field is checked against the frame it is actually read from: a
      // KPI's spark fields live in `spark.from`, and checking them against the
      // value frame would report a field that is present as missing.
      for (const { frame: frameId, field } of fieldBindings(b)) {
        const frame = ctx.frames.get(frameId);
        if (!frame) continue;
        if (!frame.fields.includes(field)) {
          return {
            ruleId: "block.missing_field",
            where: b.id,
            facts: { field, frame: frameId, available: frame.fields.slice(0, 20) },
          };
        }
      }
      return null;
    },
    message: (v) => `Field "${f<string>(v, "field")}" does not exist in frame "${f<string>(v, "frame")}".`,
    fix: (v) => `Available: ${f<string[]>(v, "available").join(", ")}.`,
  },

  /* -- perceptual ------------------------------------------------ */

  {
    id: "pie.too_many_categories",
    level: "error",
    phase: "perceptual",
    scope: ["pie"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "pie" }>;
      const frame = ctx.frames.get(b.from);
      if (!frame) return null;
      const categories = distinctCount(frame.rows, b.category);
      if (categories <= LIMITS.PIE_MAX_CATEGORIES) return null;
      return { ruleId: "pie.too_many_categories", where: b.id, facts: { categories, metric: b.value, by: b.category } };
    },
    message: (v) =>
      `Donut has ${f<number>(v, "categories")} slices; above ${LIMITS.PIE_MAX_CATEGORIES} the angles are unreadable.`,
    fix: () => "Use a bar block, or add a topK derivation first.",
    repair(v, ctx) {
      const categories = f<number>(v, "categories");
      // Within bar range, changing the mark is enough. Past it the chart needs a
      // topK too, or a bar chart of ninety categories replaces one bad chart
      // with another.
      if (categories <= LIMITS.BAR_MAX_CATEGORIES) {
        return {
          ops: [{ op: "changeKind", id: v.where, to: "bar", encoding: { x: f(v, "by"), y: [f(v, "metric")] } }],
          note: "Donut became a bar chart.",
          lossy: false,
        };
      }
      if (!ctx.canRewriteDerivations) return null;
      const id = ctx.mintId(`${v.where}_top`);
      return {
        ops: [
          { op: "addDerivation", derivation: { op: "topK", id, from: "", by: f(v, "by"), metric: f(v, "metric"), k: 12, other: true } },
          { op: "rebind", blockId: v.where, from: id },
          { op: "changeKind", id: v.where, to: "bar", encoding: { x: f(v, "by"), y: [f(v, "metric")] } },
        ],
        note: "Donut became a top-12 bar chart with the tail rolled into Other.",
        lossy: true,
      };
    },
  },

  {
    id: "pie.negative_values",
    level: "error",
    phase: "perceptual",
    scope: ["pie"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "pie" }>;
      const frame = ctx.frames.get(b.from);
      if (!frame) return null;
      if (!frame.rows.some((r) => Number(r[b.value]) < 0)) return null;
      return { ruleId: "pie.negative_values", where: b.id, facts: { value: b.value, by: b.category } };
    },
    message: (v) => `"${f<string>(v, "value")}" contains negative values, which cannot be a share of a whole.`,
    fix: () => "Use a bar block instead.",
    repair: (v) => ({
      // Never topK here: a negative value is exactly what someone needs to see,
      // and rolling it into "Other" would hide the finding.
      ops: [{ op: "changeKind", id: v.where, to: "bar", encoding: { x: f(v, "by"), y: [f(v, "value")] } }],
      note: "Donut became a bar chart, because negatives cannot be a share.",
      lossy: false,
    }),
  },

  {
    id: "bar.too_many_categories",
    level: "error",
    phase: "perceptual",
    scope: ["bar"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "bar" }>;
      const frame = ctx.frames.get(b.from);
      if (!frame) return null;
      const categories = distinctCount(frame.rows, b.x);
      if (categories <= LIMITS.BAR_MAX_CATEGORIES) return null;
      return { ruleId: "bar.too_many_categories", where: b.id, facts: { categories, by: b.x, metric: b.y[0] } };
    },
    message: (v) =>
      `Bar chart has ${f<number>(v, "categories")} categories; above ${LIMITS.BAR_MAX_CATEGORIES} it reads as a barcode.`,
    fix: () => `Add { op: "topK", k: 12, other: true } before this block.`,
    repair(v, ctx) {
      if (!ctx.canRewriteDerivations) return null;
      const id = ctx.mintId(`${v.where}_top`);
      return {
        ops: [
          { op: "addDerivation", derivation: { op: "topK", id, from: "", by: f(v, "by"), metric: f(v, "metric"), k: 12, other: true } },
          { op: "rebind", blockId: v.where, from: id },
        ],
        note: "Kept the top 12 categories and rolled the rest into Other.",
        lossy: true,
      };
    },
  },

  {
    id: "bar.too_many_series",
    level: "error",
    phase: "perceptual",
    scope: ["bar"],
    detect(target) {
      const b = asBlock(target) as Extract<Block, { kind: "bar" }>;
      if (b.y.length <= LIMITS.MAX_SERIES) return null;
      return { ruleId: "bar.too_many_series", where: b.id, facts: { count: b.y.length, series: b.y } };
    },
    message: (v) => `${f<number>(v, "count")} series exceeds the ${LIMITS.MAX_SERIES}-colour limit.`,
    fix: () => "Split into multiple blocks.",
    repair: (v) => {
      const series = f<string[]>(v, "series");
      const dropped = series.slice(LIMITS.MAX_SERIES);
      return {
        ops: [{ op: "updateBlock", id: v.where, set: { y: series.slice(0, LIMITS.MAX_SERIES) } }],
        note: `Dropped ${dropped.length} series past the colour limit: ${dropped.join(", ")}.`,
        lossy: true,
      };
    },
  },

  {
    id: "timeseries.too_many_points",
    level: "error",
    phase: "perceptual",
    scope: ["timeseries"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "timeseries" }>;
      const frame = ctx.frames.get(b.from);
      if (!frame || frame.rows.length <= LIMITS.LINE_MAX_POINTS) return null;
      return { ruleId: "timeseries.too_many_points", where: b.id, facts: { points: frame.rows.length, x: b.x, y: seriesFields(b)[0], from: b.from } };
    },
    message: (v) =>
      `${f<number>(v, "points")} points on one line exceeds the ${LIMITS.LINE_MAX_POINTS}-point budget.`,
    fix: () =>
      `Add { op: "downsample", points: ${LIMITS.LINE_MAX_POINTS} } or bucket to a coarser unit.`,
    repair(v, ctx) {
      if (!ctx.canRewriteDerivations) return null;

      // Walk upstream for a timeBucket first. Widening the bucket is what a
      // human would do when the date range grew, and it keeps every point real;
      // downsampling throws points away to make a picture fit. Preferring the
      // bucket means the "range grew" case costs no extra code.
      const from = f<string>(v, "from");
      const upstream = ctx.spec.derivations.find((d) => d.id === from && d.op === "timeBucket");
      if (upstream && upstream.op === "timeBucket") {
        const next = COARSER[upstream.unit];
        if (next) {
          return {
            ops: [{ op: "updateDerivation", id: upstream.id, set: { unit: next } }],
            note: `Re-bucketed from ${upstream.unit} to ${next} — the range outgrew the old bucket width.`,
            lossy: false,
          };
        }
      }

      const id = ctx.mintId(`${v.where}_lttb`);
      return {
        ops: [
          { op: "addDerivation", derivation: { op: "downsample", id, from, x: f(v, "x"), y: f(v, "y"), points: LIMITS.LINE_MAX_POINTS } },
          { op: "rebind", blockId: v.where, from: id },
        ],
        note: `Downsampled to ${LIMITS.LINE_MAX_POINTS} points, keeping the peaks.`,
        lossy: true,
      };
    },
  },

  {
    id: "timeseries.too_many_series",
    level: "error",
    phase: "perceptual",
    scope: ["timeseries"],
    detect(target) {
      const b = asBlock(target) as Extract<Block, { kind: "timeseries" }>;
      const series = seriesFields(b);
      if (series.length <= LIMITS.MAX_SERIES) return null;
      return { ruleId: "timeseries.too_many_series", where: b.id, facts: { count: series.length, series } };
    },
    message: (v) => `${f<number>(v, "count")} series exceeds the ${LIMITS.MAX_SERIES}-colour limit.`,
    // The bar version of this rule always had a fix and this one did not, for no
    // reason anyone could defend. Same rule, same advice.
    fix: () => "Split into multiple blocks.",
    repair: (v) => {
      const series = f<string[]>(v, "series");
      const dropped = series.slice(LIMITS.MAX_SERIES);
      return {
        ops: [{ op: "updateBlock", id: v.where, set: { y: series.slice(0, LIMITS.MAX_SERIES) } }],
        note: `Dropped ${dropped.length} series past the colour limit: ${dropped.join(", ")}.`,
        lossy: true,
      };
    },
  },

  {
    id: "timeseries.stack_single_series",
    level: "warning",
    phase: "perceptual",
    scope: ["timeseries"],
    detect(target) {
      const b = asBlock(target) as Extract<Block, { kind: "timeseries" }>;
      if (!b.stack || b.y.length !== 1) return null;
      return { ruleId: "timeseries.stack_single_series", where: b.id, facts: {} };
    },
    message: () => "Stacking a single series has no effect.",
    fix: () => "Set stack: false.",
    repair: (v) => ({
      ops: [{ op: "updateBlock", id: v.where, set: { stack: false } }],
      note: "Turned off stacking on a single-series chart.",
      lossy: false,
    }),
  },

  {
    id: "timeseries.log_scale_nonpositive",
    level: "error",
    phase: "perceptual",
    scope: ["timeseries"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "timeseries" }>;
      if (b.yScale !== "log") return null;
      const frame = ctx.frames.get(b.from);
      if (!frame) return null;
      const fields = seriesFields(b);
      if (!frame.rows.some((r) => fields.some((k) => Number(r[k]) <= 0))) return null;
      return { ruleId: "timeseries.log_scale_nonpositive", where: b.id, facts: {} };
    },
    message: () => "Log scale with zero or negative values leaves gaps that read as missing data.",
    fix: () => "Use a linear scale.",
    repair: (v) => ({
      ops: [{ op: "updateBlock", id: v.where, set: { yScale: "linear" } }],
      note: "Switched to a linear scale, because the series contains zeros.",
      lossy: false,
    }),
  },

  {
    id: "table.needs_virtualization",
    level: "error",
    phase: "perceptual",
    scope: ["table"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "table" }>;
      const frame = ctx.frames.get(b.from);
      if (!frame || b.virtualize || frame.rows.length <= LIMITS.TABLE_VIRTUALIZE_ABOVE) return null;
      return { ruleId: "table.needs_virtualization", where: b.id, facts: { rows: frame.rows.length } };
    },
    message: (v) => `Table renders ${f<number>(v, "rows")} rows without virtualization.`,
    fix: () => "Set virtualize: true.",
    repair: (v) => ({
      ops: [{ op: "updateBlock", id: v.where, set: { virtualize: true } }],
      note: "Turned on windowed rendering for a large table.",
      lossy: false,
    }),
  },

  {
    id: "scatter.overplot",
    level: "warning",
    phase: "perceptual",
    scope: ["scatter"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "scatter" }>;
      const frame = ctx.frames.get(b.from);
      if (!frame || frame.rows.length <= LIMITS.SCATTER_MAX_POINTS) return null;
      return { ruleId: "scatter.overplot", where: b.id, facts: { points: frame.rows.length } };
    },
    message: (v) => `${f<number>(v, "points")} points will overplot into a solid mass.`,
    fix: () => "Sample, bin into a heatmap, or aggregate first.",
    // No repair. Every remedy — sampling, binning, aggregating — makes a
    // different claim than the point cloud does, so the choice is the author's.
  },

  {
    id: "kpi.sum_monotonic",
    level: "error",
    phase: "perceptual",
    scope: ["kpi"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "kpi" }>;
      if (b.agg !== "sum" || !ctx.profile) return null;
      const pf = profileField(ctx, b.field);
      if (!pf?.numeric?.monotonic) return null;
      return { ruleId: "kpi.sum_monotonic", where: b.id, facts: { field: b.field, agg: aggFor(pf) } };
    },
    message: (v) => `"${f<string>(v, "field")}" is monotonic — a running total. Summing it double-counts.`,
    fix: (v) => `Use agg: "${f<string>(v, "agg")}".`,
    // aggFor is the same function the fix string names, so the repair cannot
    // set something the message did not promise.
    repair: (v) => ({
      ops: [{ op: "updateBlock", id: v.where, set: { agg: f(v, "agg") } }],
      note: `Changed the aggregate to ${f<string>(v, "agg")} on a running total.`,
      lossy: false,
    }),
  },

  {
    id: "kpi.sum_percent",
    level: "error",
    phase: "perceptual",
    scope: ["kpi"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "kpi" }>;
      if (b.agg !== "sum" || !ctx.profile) return null;
      const pf = profileField(ctx, b.field);
      if (pf?.unit !== "percent") return null;
      return { ruleId: "kpi.sum_percent", where: b.id, facts: { field: b.field, agg: aggFor(pf) } };
    },
    message: (v) => `"${f<string>(v, "field")}" is a percentage; summing percentages is meaningless.`,
    fix: (v) => `Use agg: "${f<string>(v, "agg")}".`,
    repair: (v) => ({
      ops: [{ op: "updateBlock", id: v.where, set: { agg: f(v, "agg") } }],
      note: `Changed the aggregate to ${f<string>(v, "agg")} on a percentage.`,
      lossy: false,
    }),
  },

  {
    id: "kpi.sum_duration",
    level: "error",
    phase: "perceptual",
    scope: ["kpi"],
    detect(target, ctx) {
      const b = asBlock(target) as Extract<Block, { kind: "kpi" }>;
      if (b.agg !== "sum" || !ctx.profile) return null;
      const pf = profileField(ctx, b.field);
      if (pf?.unit !== "ms") return null;
      return { ruleId: "kpi.sum_duration", where: b.id, facts: { field: b.field, agg: aggFor(pf) } };
    },
    message: (v) =>
      `"${f<string>(v, "field")}" is a duration; a total of all latencies is not a number anyone acts on.`,
    fix: (v) => `Use agg: "${f<string>(v, "agg")}" or "avg".`,
    repair: (v) => ({
      ops: [{ op: "updateBlock", id: v.where, set: { agg: f(v, "agg") } }],
      note: `Changed the aggregate to ${f<string>(v, "agg")} on a duration.`,
      lossy: false,
    }),
  },

  /* -- dashboard -------------------------------------------------- */

  {
    id: "spec.too_sparse",
    level: "warning",
    phase: "dashboard",
    scope: "$",
    detect(target) {
      const spec = asSpec(target);
      const total = spec.blocks.reduce((a, b) => a + b.span, 0);
      if (total >= 6) return null;
      return { ruleId: "spec.too_sparse", where: "$", facts: { total } };
    },
    message: () => "The dashboard is very sparse; it may look unfinished.",
    fix: () => undefined,
  },

  {
    id: "spec.too_many_kpis",
    level: "warning",
    phase: "dashboard",
    scope: "$",
    detect(target) {
      const spec = asSpec(target);
      const count = spec.blocks.filter((b) => b.kind === "kpi").length;
      if (count <= 6) return null;
      return { ruleId: "spec.too_many_kpis", where: "$", facts: { count } };
    },
    message: () => "More than six KPI tiles competes for attention.",
    fix: () => "Keep the headline row to four.",
  },

  {
    id: "spec.client_mode_too_many_rows",
    level: "error",
    phase: "dashboard",
    scope: "$",
    detect(target) {
      const spec = asSpec(target);
      if (spec.dataset.mode !== "client" || spec.dataset.rowCount <= LIMITS.CLIENT_MODE_MAX_ROWS) return null;
      return { ruleId: "spec.client_mode_too_many_rows", where: "$", facts: { rows: spec.dataset.rowCount } };
    },
    message: (v) =>
      `Client mode ships ${f<number>(v, "rows")} rows to the browser, above the ${LIMITS.CLIENT_MODE_MAX_ROWS} limit.`,
    fix: () => 'Set mode: "server".',
    repair: (v) => ({
      ops: [{ op: "setMode", mode: "server" }],
      note: "Switched to server mode; rows stay on the machine that produced them.",
      lossy: false,
    }),
  },
];

/** Rules that apply to a given block kind, in phase order. */
export function rulesForKind(kind: Block["kind"]): Rule[] {
  return RULES.filter((r) => r.scope !== "$" && r.scope.includes(kind));
}

/** Rules that apply to the spec as a whole, in phase order. */
export function specRules(phase: Phase): Rule[] {
  return RULES.filter((r) => r.scope === "$" && r.phase === phase);
}

export const RULES_BY_ID: Record<string, Rule> = Object.fromEntries(RULES.map((r) => [r.id, r]));
