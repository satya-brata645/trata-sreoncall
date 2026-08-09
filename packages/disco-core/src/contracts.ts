import type { Block, BlockKind } from "./spec";

/**
 * Size contracts — what a block needs in order to remain legible, and what it
 * becomes when it cannot have it.
 *
 * Contracts are keyed by *variant*, not by kind. A degraded form is simply
 * another contract, so stepping down a ladder is `CONTRACTS[c.ladder[0]]` with
 * no special cases anywhere in the solver.
 *
 * Every minimum carries a written justification. That matters more than the
 * number: a threshold nobody can argue with is a threshold nobody can fix, and
 * these will need tuning against real windows.
 *
 * The sizing budget these are designed against is the DOS window floor —
 * 468x288 — minus window chrome and Disco's own header, leaving roughly
 * 436x176 of content. Degradation is the normal path at that size, not an edge
 * case, which is why every kind except scatter has somewhere to go.
 */

export type BlockVariant =
  | "kpi" | "kpi.compact" | "kpi.inline"
  | "timeseries" | "timeseries.sparkline"
  | "bar" | "bar.horizontal" | "bar.top5" | "bar.list"
  | "pie" | "pie.share_bar"
  | "scatter"
  | "histogram" | "histogram.sparkbars"
  | "heatmap" | "heatmap.rowstrip"
  | "table" | "table.top5"
  | "funnel" | "funnel.compact" | "funnel.list"
  | "radar" | "radar.bars"
  | "radial" | "radial.bar"
  | "callout" | "callout.compact" | "callout.count"
  | "text" | "text.clamped";

/** What a block may draw at its assigned size. Replaces per-component guesswork. */
export interface Affordances {
  title: boolean;
  subtitle: boolean;
  legend: boolean;
  xAxis: boolean;
  yAxis: boolean;
  grid: boolean;
  /** Direct labels on marks. Identity must never rest on colour alone. */
  valueLabels: boolean;
  maxTicksX: number;
  maxTicksY: number;
  /** Where a legend goes when there is one. Wide cards put it beside the plot. */
  legendSide: "bottom" | "right";
  /** Set when a rung truncates: bar.top5 and table.top5 both cap at 5. */
  maxItems?: number;
}

export interface SizeContract {
  variant: BlockVariant;
  kind: BlockKind;
  min: { w: number; h: number };
  ideal: { w: number; h: number };
  /** Chart-body aspect band as h/w. Holds slope honest — see invariant 3. */
  aspect?: { lo: number; hi: number };
  grow: "both" | "width" | "height" | "none";
  /** Higher survives longer. Ties are broken by spec order. */
  priority: number;
  /** Intrinsic height per row, for forms whose height follows the data. */
  perRow?: number;
  maxH?: number;
  /** The next rung down. `null` means hide instead of degrade. */
  next: BlockVariant | null;
  /** Why `min` is what it is. Surfaced in the layout inspector. */
  legibility: string;
}

const C = (c: SizeContract): SizeContract => c;

export const CONTRACTS: Record<BlockVariant, SizeContract> = {
  /* ---------------------------------------------------------------- *
   * KPI — the headline. Never hidden: a dashboard with no number on it
   * has stopped answering the question it was built for.
   * ---------------------------------------------------------------- */
  kpi: C({
    variant: "kpi", kind: "kpi",
    min: { w: 132, h: 76 }, ideal: { w: 220, h: 120 },
    grow: "width", priority: 90, next: "kpi.compact",
    legibility:
      '"$1.24M" at 24px semibold runs ~96px; with 16px padding either side and a ' +
      "5-character delta chip, 132 is the narrowest that does not clip. 76 tall is " +
      "14 label + 30 value + 20 caption plus leading.",
  }),
  "kpi.compact": C({
    variant: "kpi.compact", kind: "kpi",
    min: { w: 132, h: 56 }, ideal: { w: 180, h: 56 },
    grow: "width", priority: 90, next: "kpi.inline",
    legibility: "Sparkline and aggregate caption dropped; the value line is the irreducible unit.",
  }),
  "kpi.inline": C({
    variant: "kpi.inline", kind: "kpi",
    min: { w: 132, h: 32 }, ideal: { w: 180, h: 32 },
    grow: "width", priority: 90, next: null,
    legibility: "Label and value share one baseline. Below 32 the 24px value clips.",
  }),

  /* ---------------------------------------------------------------- *
   * Time series — the highest-priority chart. A dashboard about change
   * that cannot show change has failed at its only job.
   * ---------------------------------------------------------------- */
  timeseries: C({
    variant: "timeseries", kind: "timeseries",
    min: { w: 280, h: 160 }, ideal: { w: 520, h: 300 },
    aspect: { lo: 0.35, hi: 0.75 },
    grow: "both", priority: 95, next: "timeseries.sparkline",
    legibility:
      "52px y-gutter plus ~220px of plot yields 4 readable x-ticks at minTickGap 28; " +
      "with fewer than 4 a trend is an anecdote. 160 tall keeps three gridlines >43px " +
      "apart — closer and slope reads as noise.",
  }),
  "timeseries.sparkline": C({
    variant: "timeseries.sparkline", kind: "timeseries",
    min: { w: 120, h: 40 }, ideal: { w: 240, h: 56 },
    aspect: { lo: 0.18, hi: 0.5 },
    grow: "width", priority: 95, next: null,
    legibility:
      "Axes dropped, endpoints labelled instead. 40 tall is the proven KPI spark height; " +
      "shape survives even when scale is no longer readable.",
  }),

  /* ---------------------------------------------------------------- *
   * Bar — degrades sideways before it degrades away, because horizontal
   * bars trade a scarce axis (width) for a cheap one (scroll height).
   * ---------------------------------------------------------------- */
  bar: C({
    variant: "bar", kind: "bar",
    min: { w: 220, h: 140 }, ideal: { w: 460, h: 260 },
    // No aspect band. A bar encodes its value in LENGTH, so a taller chart just
    // makes the bars taller — it distorts nothing. Bands are reserved for marks
    // whose shape carries meaning, where stretching is a lie about the data.
    grow: "both", priority: 70, next: "bar.horizontal",
    legibility:
      "20px per category = a 14px bar plus a 6px gap. Under 14px wide a bar cannot " +
      "carry an 11px label beneath it and reads as a tick mark.",
  }),
  "bar.horizontal": C({
    variant: "bar.horizontal", kind: "bar",
    min: { w: 220, h: 120 }, ideal: { w: 480, h: 300 },
    grow: "width", priority: 70, next: "bar.top5", perRow: 24, maxH: 640,
    legibility:
      "132px label gutter + 80px bar track + 8px padding. 24px rows = an 11px label " +
      "with 13px leading; tighter and consecutive labels collide.",
  }),
  "bar.top5": C({
    variant: "bar.top5", kind: "bar",
    min: { w: 220, h: 176 }, ideal: { w: 360, h: 176 },
    grow: "width", priority: 70, next: "bar.list",
    legibility: "Six rows — five plus Other — at 24px, plus a 32px header.",
  }),
  "bar.list": C({
    variant: "bar.list", kind: "bar",
    min: { w: 180, h: 120 }, ideal: { w: 280, h: 160 },
    grow: "width", priority: 70, next: null, perRow: 22,
    legibility: "Name/value rows with share drawn as a background fill. No axis at all.",
  }),

  /* ---------------------------------------------------------------- *
   * Pie — the most size-sensitive form in the catalog, because the
   * encoding IS geometry.
   * ---------------------------------------------------------------- */
  pie: C({
    variant: "pie", kind: "pie",
    min: { w: 200, h: 200 }, ideal: { w: 340, h: 300 },
    // Deliberately NO aspect band. A donut shares a row with whatever sits
    // beside it, and rows share one height — so demanding a square card would
    // either stretch its neighbour or shrink the donut below legibility. The
    // circle is centred inside whatever card it gets and the legend moves to
    // the side when the card is wide, which is the standard solution and needs
    // no constraint on the card itself.
    grow: "both", priority: 55, next: "pie.share_bar",
    legibility:
      "outerRadius must stay >=60: below it the 6th slice's chord is shorter than the " +
      "2px stroke separating it. That needs 2r + padding = 200 in the smaller dimension, " +
      "plus room for a legend, because identity may never rest on colour alone.",
  }),
  "pie.share_bar": C({
    variant: "pie.share_bar", kind: "pie",
    min: { w: 220, h: 64 }, ideal: { w: 380, h: 80 },
    grow: "width", priority: 55, next: null,
    legibility:
      "One 100%-stacked horizontal bar plus wrapped labels. Shares stay exact; only the " +
      "angle encoding is lost, and angle was always the weakest part of a donut.",
  }),

  /* ---------------------------------------------------------------- *
   * Scatter — the one form with no ladder. Every summary of a point
   * cloud makes a different claim than the cloud does, so it hides
   * rather than lie about what it is showing.
   * ---------------------------------------------------------------- */
  scatter: C({
    variant: "scatter", kind: "scatter",
    min: { w: 260, h: 200 }, ideal: { w: 480, h: 360 },
    aspect: { lo: 0.6, hi: 1.0 },
    grow: "both", priority: 30, next: null,
    legibility:
      "Two quantitative axes both need ticks. Below 200 tall the y-range compresses " +
      "until distinct clusters merge into a single mass, which is worse than absence.",
  }),

  /* ---------------------------------------------------------------- *
   * Histogram
   * ---------------------------------------------------------------- */
  histogram: C({
    variant: "histogram", kind: "histogram",
    min: { w: 220, h: 140 }, ideal: { w: 420, h: 240 },
    // As with bars: bin height is the encoding, and stretching it distorts
    // nothing about the distribution's shape.
    grow: "both", priority: 50, next: "histogram.sparkbars",
    legibility:
      "24 bins at ~7px plus a 44px y-gutter. Under 7px a bin is thinner than its own " +
      "3px corner radius and the distribution turns into a smear.",
  }),
  "histogram.sparkbars": C({
    variant: "histogram.sparkbars", kind: "histogram",
    min: { w: 140, h: 56 }, ideal: { w: 240, h: 72 },
    grow: "width", priority: 50, next: null,
    legibility: "Axis-free bars with min, median and max annotated — shape without scale.",
  }),

  /* ---------------------------------------------------------------- *
   * Heatmap
   * ---------------------------------------------------------------- */
  heatmap: C({
    variant: "heatmap", kind: "heatmap",
    min: { w: 220, h: 160 }, ideal: { w: 420, h: 300 },
    grow: "both", priority: 40, next: "heatmap.rowstrip", perRow: 24,
    legibility: "28px cells, matching the rendered grid. Below that a cell value is a pixel.",
  }),
  "heatmap.rowstrip": C({
    variant: "heatmap.rowstrip", kind: "heatmap",
    min: { w: 200, h: 140 }, ideal: { w: 320, h: 180 },
    grow: "width", priority: 40, next: null, perRow: 20,
    legibility: "Top six rows only, as single-row intensity strips.",
  }),

  /* ---------------------------------------------------------------- *
   * Table
   * ---------------------------------------------------------------- */
  table: C({
    variant: "table", kind: "table",
    min: { w: 300, h: 120 }, ideal: { w: 640, h: 380 },
    grow: "both", priority: 60, next: "table.top5", perRow: 34, maxH: 520,
    legibility:
      "Three columns at 90-120px each. 120 tall is a 30px header, two 34px rows and a " +
      "22px footer — a table showing one row is not a table.",
  }),
  "table.top5": C({
    variant: "table.top5", kind: "table",
    min: { w: 220, h: 120 }, ideal: { w: 360, h: 220 },
    grow: "both", priority: 60, next: null, perRow: 30,
    legibility: "Five rows and the two highest-priority columns; sort chrome dropped.",
  }),


  /* ---------------------------------------------------------------- *
   * Funnel — the highest-priority block on a pipeline dashboard,
   * because it is the only one that shows where work is LOST.
   * ---------------------------------------------------------------- */
  funnel: C({
    variant: "funnel", kind: "funnel",
    min: { w: 320, h: 150 }, ideal: { w: 900, h: 190 },
    grow: "both", priority: 92, next: "funnel.compact", perRow: 0, maxH: 260,
    legibility:
      "Stages are laid out across the width, so the minimum is set by the narrowest " +
      "readable stage card (~78px for a compact count plus a share) times four — below " +
      "four stages a funnel stops showing a progression and becomes two numbers.",
  }),
  "funnel.compact": C({
    variant: "funnel.compact", kind: "funnel",
    min: { w: 260, h: 110 }, ideal: { w: 620, h: 130 },
    grow: "width", priority: 92, next: "funnel.list", maxH: 160,
    legibility: "Attrition lines and stage durations drop; the count and share-of-previous stay.",
  }),
  "funnel.list": C({
    variant: "funnel.list", kind: "funnel",
    min: { w: 200, h: 120 }, ideal: { w: 320, h: 220 },
    grow: "width", priority: 92, next: null, perRow: 24, maxH: 320,
    legibility:
      "Stacked rows instead of a row of cards — trades the scarce axis (width) for the " +
      "cheap one (scroll height), and keeps every stage rather than truncating.",
  }),

  /* ---------------------------------------------------------------- *
   * Radar — geometry IS the encoding, so it is sized like a pie.
   * ---------------------------------------------------------------- */
  radar: C({
    variant: "radar", kind: "radar",
    min: { w: 220, h: 220 }, ideal: { w: 380, h: 320 },
    grow: "both", priority: 45, next: "radar.bars",
    legibility:
      "The polygon needs a radius of ~80 to keep six axis labels off each other, so " +
      "2r plus label gutters is 220 in the smaller dimension. Below that the axis names " +
      "collide and the shape is unreadable regardless of the data.",
  }),
  "radar.bars": C({
    variant: "radar.bars", kind: "radar",
    min: { w: 200, h: 160 }, ideal: { w: 340, h: 240 },
    grow: "width", priority: 45, next: null, perRow: 22, maxH: 340,
    legibility:
      "Grouped bars, one group per axis. The honest degradation: it loses the silhouette " +
      "but keeps every value comparable, which is what the radar was for.",
  }),

  /* ---------------------------------------------------------------- *
   * Radial — a gauge. Arcs need radius the way a donut does.
   * ---------------------------------------------------------------- */
  radial: C({
    variant: "radial", kind: "radial",
    min: { w: 200, h: 180 }, ideal: { w: 360, h: 260 },
    grow: "both", priority: 50, next: "radial.bar",
    legibility:
      "Concentric arcs need ~14px of ring each to stay distinguishable; six rings plus " +
      "an inner hole is 180 in the smaller dimension.",
  }),
  "radial.bar": C({
    variant: "radial.bar", kind: "radial",
    min: { w: 180, h: 110 }, ideal: { w: 300, h: 180 },
    grow: "width", priority: 50, next: null, perRow: 22, maxH: 260,
    legibility:
      "Horizontal progress bars carry exactly the same information as the arcs — a " +
      "magnitude against a ceiling — and read better narrow than a squashed dial.",
  }),

  /* ---------------------------------------------------------------- *
   * Callout — never hidden. A dashboard that drops its "needs
   * attention" list at a small size has hidden the only thing on it
   * that was urgent.
   * ---------------------------------------------------------------- */
  callout: C({
    variant: "callout", kind: "callout",
    min: { w: 260, h: 120 }, ideal: { w: 560, h: 300 },
    grow: "both", priority: 88, next: "callout.compact", perRow: 52, maxH: 420,
    legibility:
      "A two-line item needs ~52px; 260 wide is a status chip plus ~30 characters of " +
      "title, which is the least that distinguishes one incident from another.",
  }),
  "callout.compact": C({
    variant: "callout.compact", kind: "callout",
    min: { w: 200, h: 92 }, ideal: { w: 320, h: 200 },
    grow: "width", priority: 88, next: "callout.count", perRow: 30, maxH: 300,
    legibility: "Title and status chip only; the detail line drops.",
  }),
  "callout.count": C({
    variant: "callout.count", kind: "callout",
    min: { w: 150, h: 56 }, ideal: { w: 240, h: 64 },
    grow: "width", priority: 88, next: null,
    legibility:
      "A single line: how many items, at what worst severity. Still says something is " +
      "wrong, which is the one thing that must never disappear.",
  }),

  /* ---------------------------------------------------------------- *
   * Text
   * ---------------------------------------------------------------- */
  text: C({
    variant: "text", kind: "text",
    min: { w: 200, h: 64 }, ideal: { w: 400, h: 96 },
    grow: "width", priority: 20, next: "text.clamped",
    legibility: "Two lines at 14px/1.6 plus padding.",
  }),
  "text.clamped": C({
    variant: "text.clamped", kind: "text",
    min: { w: 160, h: 44 }, ideal: { w: 280, h: 44 },
    grow: "width", priority: 20, next: null,
    legibility: 'One line plus a "more" affordance.',
  }),
};

/** The top rung for a block kind — where every block starts before degradation. */
export const TOP_VARIANT: Record<BlockKind, BlockVariant> = {
  kpi: "kpi",
  timeseries: "timeseries",
  bar: "bar",
  pie: "pie",
  scatter: "scatter",
  histogram: "histogram",
  heatmap: "heatmap",
  table: "table",
  funnel: "funnel",
  radar: "radar",
  radial: "radial",
  callout: "callout",
  text: "text",
};

/** Ladder from a variant down to its last rung, the variant itself first. */
export function ladder(from: BlockVariant): BlockVariant[] {
  const out: BlockVariant[] = [];
  let cur: BlockVariant | null = from;
  while (cur) {
    out.push(cur);
    cur = CONTRACTS[cur].next;
  }
  return out;
}

/** How far down its ladder a variant sits. Used to test priority monotonicity. */
export function rungIndex(variant: BlockVariant): number {
  return ladder(TOP_VARIANT[CONTRACTS[variant].kind]).indexOf(variant);
}

/**
 * Data-shape facts the solver needs but must not compute itself.
 *
 * Keeping these as an input is what keeps `solveLayout` pure and cheap: the
 * hints change when the data changes, not when the window moves, so a resize
 * never touches a row.
 */
export interface BlockHint {
  rowCount: number;
  categoryCount: number;
  seriesCount: number;
  maxLabelChars: number;
}

export const DEFAULT_HINT: BlockHint = {
  rowCount: 0,
  categoryCount: 0,
  seriesCount: 1,
  maxLabelChars: 8,
};

/**
 * Height a variant intrinsically wants for its data, before the aspect band
 * and the row budget get a say. Forms whose height follows row count say so
 * through `perRow`; everything else asks for its ideal.
 */
export function intrinsicHeight(variant: BlockVariant, hint: BlockHint): number {
  const c = CONTRACTS[variant];
  if (!c.perRow) return c.ideal.h;

  const rows =
    variant === "bar.top5" || variant === "table.top5"
      ? 6
      : variant === "callout.count"
        ? 1
      : variant === "heatmap.rowstrip"
        ? Math.min(hint.categoryCount || 6, 6)
        : c.kind === "callout" || c.kind === "funnel" || c.kind === "radar" || c.kind === "radial"
          ? hint.rowCount || hint.categoryCount
        : c.kind === "table"
          ? Math.min(hint.rowCount, 12)
          : hint.categoryCount || hint.rowCount;

  // No hint yet — first paint, or a caller that has not measured. Ask for the
  // ideal rather than collapsing to the minimum: a table that renders one row
  // tall and then jumps to full height on the next frame is worse than one that
  // starts roomy and settles.
  if (rows <= 0) return c.ideal.h;

  // 40px of chrome: header, and a footer where the form has one.
  return Math.min(c.perRow * rows + 40, c.maxH ?? Infinity);
}

/** Approximate advance width of 11px Inter. Only decides whether to truncate. */
export const CHAR_PX = 6.2;

/** What a block can draw at the size the solver gave it. */
export function affordancesFor(variant: BlockVariant, w: number, h: number, hint: BlockHint): Affordances {
  const c = CONTRACTS[variant];
  const spacious = h >= c.ideal.h * 0.8;
  /*
   * "Chart" here means "plots against axes", which is what the axis, grid and
   * legend affordances describe. A funnel is a row of stage cards and a callout
   * is a ranked list — offering them a y-axis would have them render chrome
   * they have no use for, and the solver would budget height for it.
   */
  const AXIS_LESS: BlockKind[] = ["text", "table", "kpi", "funnel", "callout"];
  const isChart = !AXIS_LESS.includes(c.kind);
  const stripped = variant.includes(".");

  // A legend costs a row of height and is only worth it with something to
  // distinguish. One series needs no legend — the title already names it.
  const legend = isChart && !stripped && hint.seriesCount > 1 && spacious;

  return {
    title: h >= 56,
    subtitle: h >= 96 && w >= 220,
    legend,
    xAxis: isChart && !stripped && h >= c.min.h + 12,
    yAxis: isChart && !stripped && w >= c.min.w + 12,
    grid: isChart && !stripped && h >= c.min.h + 24,
    // Direct labels are how identity survives without colour, so they arrive
    // as soon as there is room — and are mandatory once a legend is gone.
    valueLabels: (!legend && hint.seriesCount <= 3) || w >= c.ideal.w,
    maxTicksX: Math.max(2, Math.floor((w - 52) / 44)),
    maxTicksY: Math.max(2, Math.min(6, Math.floor(h / 40))),
    // A wide, short card has no vertical room to spare; put the legend beside
    // the plot so the plot keeps its height.
    legendSide: w > h * 1.3 ? "right" : "bottom",
    maxItems:
      variant === "bar.top5" || variant === "table.top5"
        ? 5
        : variant === "heatmap.rowstrip"
          ? 6
          : variant === "callout.count"
            ? 0
            : variant === "callout.compact"
              ? 4
              : variant === "funnel.list"
                ? 8
                : undefined,
  };
}

/** The block's own frame-independent identity, for hint lookup. */
export function hintKey(block: Block): string {
  return block.id;
}
