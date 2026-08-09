import type { FieldProfile } from "./types";

/**
 * Perceptual limits and field semantics — the leaf everything else agrees on.
 *
 * These used to live in `recommend.ts`, which meant `validate.ts` imported the
 * recommender: *the gate importing the solver*. Adding a repair layer that
 * needed both would have made the cycle worse. Nothing in here imports anything
 * but types, so the recommender (which avoids producing violations), the
 * validator (which rejects them) and the repair layer (which fixes them) can
 * all depend on one definition without depending on each other.
 *
 * Every number is a design decision with a reason, not a magic constant. When
 * one is wrong, it is wrong in exactly one place.
 */

export const LIMITS = {
  /**
   * Bounded by the validated palette, not by geometry: a 7th slice would have
   * no colour that passed CVD separation against its neighbours.
   */
  PIE_MAX_CATEGORIES: 6,
  /** Beyond this a bar chart becomes a barcode; switch to topK or a table. */
  BAR_MAX_CATEGORIES: 25,
  /** Distinguishable series in one chart before colour stops carrying meaning. */
  MAX_SERIES: 6,
  /** Points per line before LTTB downsampling is inserted. */
  LINE_MAX_POINTS: 500,
  /** Rows a table renders unwindowed. */
  TABLE_VIRTUALIZE_ABOVE: 200,
  /**
   * Points on a scatter before the cloud overplots into a solid mass. Was a
   * bare literal inside the validator, which meant the recommender had no way
   * to avoid producing a chart the gate would then complain about.
   */
  SCATTER_MAX_POINTS: 5_000,
  /** Rows shipped to the browser before the pipeline switches to server mode. */
  CLIENT_MODE_MAX_ROWS: 25_000,
} as const;

/**
 * The formats a *measure* can take.
 *
 * Deliberately narrower than `Format` in format.ts, which also covers
 * "duration" — that one is chosen by a block author for a computed column, not
 * inferred from a field's unit. Keeping the inferred set smaller means
 * `formatFor` cannot return something the profiler has no basis for.
 */
export type MeasureFormat = "number" | "compact" | "usd" | "percent" | "bytes" | "ms";

/** How a measure should be rendered, from the unit the profiler guessed. */
export function formatFor(f: FieldProfile | undefined): MeasureFormat {
  switch (f?.unit) {
    case "usd": return "usd";
    case "percent": return "percent";
    case "bytes": return "bytes";
    case "ms": return "ms";
    case "count": return "compact";
    default:
      // Big raw numbers are unreadable at tile size; compact them.
      return (f?.numeric?.max ?? 0) >= 10_000 ? "compact" : "number";
  }
}

/** The aggregates `aggFor` can return — a strict subset of `AggSchema`. */
export type SafeAgg = "sum" | "avg" | "last" | "p95";

/**
 * Not everything numeric is summable.
 *
 * A running total double-counts when summed, a percentage loses its meaning,
 * and total latency is a number nobody acts on — for a duration the typical
 * case is what matters.
 *
 * This is the exact inverse of the three KPI aggregate rules in the validator,
 * whose fix strings literally name these outputs ("Use agg: \"last\""). Sharing
 * it means a repair produces precisely the value the error message promised,
 * rather than a second implementation that can drift from the prose.
 */
export const aggFor = (f: FieldProfile | undefined): SafeAgg => {
  if (f?.numeric?.monotonic) return "last";
  if (f?.unit === "percent") return "avg";
  if (f?.unit === "ms") return "p95";
  return "sum";
};
