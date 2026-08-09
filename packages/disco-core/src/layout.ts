import {
  CONTRACTS,
  DEFAULT_HINT,
  TOP_VARIANT,
  affordancesFor,
  intrinsicHeight,
  type Affordances,
  type BlockHint,
  type BlockVariant,
} from "./contracts";
import type { Block } from "./spec";
import type { Frame } from "./algebra";

/**
 * The layout solver.
 *
 * Disco renders inside a window that the user drags to any size above a
 * 468x288 floor, so viewport breakpoints are meaningless — a 500px window on a
 * 27" monitor is still a 500px window. This decides, from the rect alone, what
 * each block becomes and where it goes.
 *
 * It is a pure function: no DOM, no clock, no randomness. That is what makes it
 * snapshot-testable, safe to run during server rendering, and cheap enough to
 * call on every frame of a resize drag.
 *
 * It is a **line breaker**, not a bin packer. Masonry would reorder blocks to
 * fill gaps, but spec order is the composer's argument about what matters —
 * scrambling it to save whitespace destroys the thing the agent was asked to
 * produce. The solver chooses line breaks and sizes; it never reorders.
 */

export interface Rect {
  w: number;
  h: number;
}

export type LayoutHints = Record<string, BlockHint>;

export interface PlacedBlock {
  blockId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  variant: BlockVariant;
  /** Set when the solver stepped this block down its ladder. */
  degradedFrom?: BlockVariant;
  /** Why, in one line, for the user. Never degrade silently. */
  degradeReason?: string;
  affordances: Affordances;
}

export interface Layout {
  rect: Rect;
  cols: number;
  colWidth: number;
  gutter: number;
  blocks: PlacedBlock[];
  hidden: Array<{ blockId: string; reason: string }>;
  contentHeight: number;
  /** Concessions the solver made, for the "why does it look like this" popover. */
  notes: string[];
}

export interface LayoutOptions {
  gutter?: number;
  padding?: number;
  headerHeight?: number;
  /** Height quantum, so rows share a rhythm instead of landing on odd pixels. */
  rowUnit?: number;
  /**
   * "vertical" (the default): the surface scrolls, so height is cheap and only
   * WIDTH forces degradation. This is the central call of the whole solver —
   * see the note in `solveLayout`.
   */
  scroll?: "vertical" | "none";
  /** Previous layout, for hysteresis. Passing it as input keeps this pure. */
  previous?: Layout;
}

const DEFAULTS = {
  gutter: 12,
  padding: 16,
  headerHeight: 0,
  rowUnit: 4,
  scroll: "vertical" as const,
};

/**
 * Only divisors of 12, so `span * cols / 12` is exact integer arithmetic.
 *
 * That is not an aesthetic choice — it is what keeps a `span: 8` block exactly
 * two-thirds of the row at *every* window size. With 5 or 7 columns the same
 * block would round differently at different widths and the reading hierarchy
 * would drift as the user resized.
 */
const COLUMN_CHOICES = [1, 2, 3, 4, 6, 12] as const;

/**
 * Narrowest column worth having.
 *
 * A block never has to fit inside one column — step A widens its span until it
 * does — so this is not a legibility floor but a granularity one. It only needs
 * to be small enough that useful span arithmetic exists.
 *
 * 64 is deliberately generous. At 12 columns a `span: 3` KPI is a quarter of
 * the row, which is the canonical headline layout; a higher floor keeps 12
 * columns locked until ~1400px and forces four tiles to stack two-by-two at
 * 520px each, which reads as a bug. Coarse columns cost more than narrow ones.
 */
const MIN_COL_PX = 64;

/** Width a degraded block must exceed before it climbs back. See invariant 9. */
const HYSTERESIS_PX = 12;

const quantize = (v: number, unit: number) => Math.round(v / unit) * unit;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/* ------------------------------------------------------------------ *
 * Hints
 * ------------------------------------------------------------------ */

/**
 * Measure the data facts the solver needs, once per data change.
 *
 * Deliberately separate from `solveLayout`: a resize must never touch a row.
 */
export function layoutHints(blocks: Block[], frames: Map<string, Frame>): LayoutHints {
  const hints: LayoutHints = {};

  for (const b of blocks) {
    if (b.kind === "text") {
      hints[b.id] = { ...DEFAULT_HINT };
      continue;
    }

    const frame = frames.get(b.from);
    const rows = frame?.rows ?? [];

    let categoryField: string | undefined;
    let seriesCount = 1;

    switch (b.kind) {
      case "bar": categoryField = b.x; seriesCount = b.y.length; break;
      case "pie": categoryField = b.category; break;
      case "timeseries": seriesCount = b.y.length; break;
      case "heatmap": categoryField = b.y; break;
      case "scatter": categoryField = b.colorBy; break;
      // The new kinds are row-driven: their height follows how many stages,
      // items or entities there are. Falling into `default` here would leave
      // them sized from their ideal, which is a guess that ignores the data.
      case "funnel": categoryField = b.stage; break;
      case "callout": categoryField = b.severityField; break;
      case "radial": categoryField = b.category; break;
      case "radar": categoryField = b.entity; seriesCount = b.series.length; break;
      default: break;
    }

    const values = categoryField ? rows.map((r) => String(r[categoryField] ?? "")) : [];
    const distinct = new Set(values);

    hints[b.id] = {
      rowCount: rows.length,
      categoryCount: distinct.size,
      seriesCount,
      maxLabelChars: values.reduce((a, v) => Math.max(a, v.length), 0) || DEFAULT_HINT.maxLabelChars,
    };
  }

  return hints;
}

/* ------------------------------------------------------------------ *
 * Units — a block, or an atomic band of them
 * ------------------------------------------------------------------ */

interface Member {
  block: Block;
  variant: BlockVariant;
  span: number;
  degradedFrom?: BlockVariant;
  degradeReason?: string;
  /**
   * Set for members of an atomic band. Leftover columns are never handed to
   * these individually — doing so makes one tile in a KPI row wider than its
   * neighbours, which is exactly the raggedness invariant 1 exists to prevent.
   */
  bandId?: string;
}

/**
 * A run of consecutive KPI blocks is placed as one unit.
 *
 * Invariant 1: a KPI row is all-or-nothing. Four tiles, or two, or one — never
 * three and an orphan, which is the single most visible way a generated
 * dashboard looks broken.
 */
interface Band {
  members: Member[];
  atomic: boolean;
}

function groupBands(members: Member[]): Band[] {
  const bands: Band[] = [];
  let run: Member[] = [];

  const flush = () => {
    if (run.length > 0) {
      const bandId = `band_${bands.length}`;
      bands.push({ members: run.map((m) => ({ ...m, bandId })), atomic: true });
      run = [];
    }
  };

  for (const m of members) {
    if (m.block.kind === "kpi") {
      run.push(m);
    } else {
      flush();
      bands.push({ members: [m], atomic: false });
    }
  }
  flush();

  return bands;
}

/* ------------------------------------------------------------------ *
 * Solve
 * ------------------------------------------------------------------ */

export function solveLayout(
  blocks: Block[],
  rect: Rect,
  hints: LayoutHints = {},
  options: LayoutOptions = {},
): Layout {
  const opts = { ...DEFAULTS, ...options };
  const notes: string[] = [];
  const hidden: Array<{ blockId: string; reason: string }> = [];

  const contentW = Math.max(rect.w - opts.padding * 2, MIN_COL_PX);
  const contentH = Math.max(rect.h - opts.padding * 2 - opts.headerHeight, 0);

  const cols = pickCols(contentW, opts.gutter);
  const colWidth = (contentW - (cols - 1) * opts.gutter) / cols;
  const spanPx = (s: number) => s * colWidth + (s - 1) * opts.gutter;

  const hintFor = (b: Block): BlockHint => hints[b.id] ?? DEFAULT_HINT;
  const previousVariant = new Map(
    (opts.previous?.blocks ?? []).map((p) => [p.blockId, p.variant] as const),
  );

  /* -- A. variant and desired span, per block ---------------------- */

  const members: Member[] = [];

  for (const block of blocks) {
    const top = TOP_VARIANT[block.kind];
    let variant = top;
    let degradedFrom: BlockVariant | undefined;
    let reason: string | undefined;

    // Hysteresis: a block that was degraded last time only climbs back once
    // there is real headroom. Without this, dragging a resize handle across a
    // threshold makes the chart strobe between two forms.
    const prev = previousVariant.get(block.id);
    if (prev && prev !== top && CONTRACTS[prev].kind === block.kind) {
      const needed = CONTRACTS[top].min.w + HYSTERESIS_PX;
      if (spanPx(cols) < needed) {
        variant = prev;
        degradedFrom = top;
        reason = CONTRACTS[prev].legibility;
      }
    }

    // Widen before degrading — a block that wants 4 columns but needs 5 gets 5.
    let span = clamp(Math.round((block.span * cols) / 12), 1, cols);
    while (span < cols && spanPx(span) < CONTRACTS[variant].min.w) span += 1;

    // Even a full row too narrow: step down the ladder.
    while (spanPx(cols) < CONTRACTS[variant].min.w) {
      const next = CONTRACTS[variant].next;
      if (!next) {
        hidden.push({
          blockId: block.id,
          reason: `needs ${CONTRACTS[variant].min.w}px of width; this window offers ${Math.round(spanPx(cols))}px`,
        });
        variant = variant; // marker; filtered below
        break;
      }
      degradedFrom ??= variant;
      variant = next;
      reason = CONTRACTS[next].legibility;
      span = cols;
    }

    if (hidden.some((h) => h.blockId === block.id)) continue;

    members.push({ block, variant, span, degradedFrom, degradeReason: reason });
  }

  /* -- B/C. bands, then a greedy line break in spec order ---------- */

  const bands = groupBands(members);
  const rows: Member[][] = [];
  let current: Member[] = [];
  let used = 0;

  for (const band of bands) {
    if (band.atomic) {
      // Invariant 1: reflow the whole band, or degrade every tile together.
      const laid = reflowBand(band.members, cols, spanPx);
      if (current.length > 0) {
        rows.push(current);
        current = [];
        used = 0;
      }
      for (const bandRow of laid) rows.push(bandRow);
      continue;
    }

    const m = band.members[0];
    if (used + m.span > cols && current.length > 0) {
      rows.push(current);
      current = [];
      used = 0;
    }
    current.push(m);
    used += m.span;
  }
  if (current.length > 0) rows.push(current);

  /* -- D/E. widths, then heights, per row -------------------------- */

  const placed: PlacedBlock[] = [];
  let y = 0;
  let prevRowH = 0;

  for (const row of rows) {
    distributeLeftover(row, cols);
    enforceWidthRatio(row, spanPx, notes);

    // Height: intrinsic, clamped into the aspect band, then to the contract.
    //
    // `floorH` is the height below which some member stops being honest — its
    // contract minimum, or the bottom of its aspect band at the width it just
    // received. Nothing below is allowed to push a row under it.
    let rowH = 0;
    let floorH = 0;

    for (const m of row) {
      const c = CONTRACTS[m.variant];
      const w = spanPx(m.span);
      let h = intrinsicHeight(m.variant, hintFor(m.block));
      if (c.aspect) h = clamp(h, w * c.aspect.lo, w * c.aspect.hi);
      h = clamp(h, c.min.h, c.maxH ?? Infinity);
      rowH = Math.max(rowH, h);
      floorH = Math.max(floorH, c.aspect ? Math.max(c.min.h, w * c.aspect.lo) : c.min.h);
    }

    rowH = quantize(Math.max(rowH, floorH), opts.rowUnit);

    // Invariant 6: no row more than twice its predecessor. A 380px table
    // directly under an 80px KPI band reads as two unrelated documents.
    //
    // Rhythm is a preference; legibility is a floor. A wide chart whose aspect
    // band demands height wins over the rhythm cap — squashing it to keep the
    // rhythm would flatten its slope into a straight line, which is a lie about
    // the data rather than a cosmetic compromise.
    if (prevRowH > 0 && rowH > prevRowH * 2) {
      const capped = quantize(Math.max(prevRowH * 2, floorH), opts.rowUnit);
      // Only worth telling the user about when the concession is visible. A
      // few pixels of rounding is not a design decision anyone needs explained.
      if (capped < rowH - 8) {
        notes.push("A row was shortened towards the one above it to keep the vertical rhythm.");
      }
      rowH = Math.min(rowH, capped);
    }

    let x = 0;
    for (const m of row) {
      const w = spanPx(m.span);
      const c = CONTRACTS[m.variant];

      // A row shares one height, but a block with an aspect band must not be
      // stretched past it by a taller neighbour — an over-tall line chart
      // exaggerates slope, which is a claim about the data rather than a
      // cosmetic difference. Such a block keeps its own height and aligns to
      // the top of the row; only marks whose height is not part of the encoding
      // (bars, tables) fill the row.
      const h = c.aspect ? Math.min(rowH, Math.max(c.min.h, w * c.aspect.hi)) : rowH;

      placed.push({
        blockId: m.block.id,
        x,
        y,
        w,
        h,
        variant: m.variant,
        degradedFrom: m.degradedFrom,
        degradeReason: m.degradedFrom ? m.degradeReason : undefined,
        affordances: affordancesFor(m.variant, w, h, hintFor(m.block)),
      });
      x += w + opts.gutter;
    }

    y += rowH + opts.gutter;
    prevRowH = rowH;
  }

  const contentHeight = Math.max(y - opts.gutter, 0);

  /* -- F. height overflow, only when the surface cannot scroll ------ */

  if (opts.scroll === "none" && contentHeight > contentH && contentH > 0) {
    // A window scrolls, so this path is off by default. It exists for embeds
    // that must fit exactly — a print view, or a fixed tile on another app's
    // canvas. Degradation is by ascending priority: the least important block
    // gives way first (invariant 8).
    return solveLayout(
      demoteLowestPriority(blocks, placed, hidden),
      rect,
      hints,
      { ...options, scroll: "none" },
    );
  }

  if (hidden.length > 0) {
    notes.push(
      `${hidden.length} block${hidden.length === 1 ? "" : "s"} hidden — widen the window to bring ${hidden.length === 1 ? "it" : "them"} back.`,
    );
  }

  return { rect, cols, colWidth, gutter: opts.gutter, blocks: placed, hidden, contentHeight, notes };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function pickCols(contentW: number, gutter: number): number {
  let best = 1;
  for (const c of COLUMN_CHOICES) {
    if ((contentW - (c - 1) * gutter) / c >= MIN_COL_PX) best = c;
  }
  return best;
}

/**
 * Lay a KPI band out as whole rows.
 *
 * The band is split into rows of equal size wherever possible, so tiles never
 * end up as "three then one". A remainder that cannot divide evenly is placed
 * as its own full-width row rather than orphaned beside a gap.
 */
function reflowBand(band: Member[], cols: number, spanPx: (s: number) => number): Member[][] {
  const n = band.length;
  const minW = CONTRACTS[band[0].variant].min.w;

  /*
   * Choose tiles-per-row by two rules, in order.
   *
   *   1. It must divide `n`, so every row holds the same count — no orphan
   *      tile, which is invariant 1 and the most visible failure of the lot.
   *   2. Among those, take the one that wastes the least width, preferring more
   *      tiles per row on a tie. Waste is what is left over after each tile
   *      takes floor(cols / perRow) columns; picking the minimum is what stops
   *      "4 tiles in 3 columns" rendering as 2 + 2 with a third of every row
   *      empty — it becomes four full-width tiles instead.
   *
   * perRow = 1 always qualifies and always wastes nothing, so a choice exists.
   */
  let perRow = 1;
  let bestFill = -1;

  for (let k = 1; k <= Math.min(cols, n); k++) {
    if (n % k !== 0) continue;
    const span = Math.floor(cols / k);
    if (span < 1 || spanPx(span) < minW) continue;
    const fill = (k * span) / cols;
    if (fill >= bestFill) {
      bestFill = fill;
      perRow = k;
    }
  }

  const span = Math.max(1, Math.floor(cols / perRow));

  const rows: Member[][] = [];
  for (let i = 0; i < n; i += perRow) {
    rows.push(band.slice(i, i + perRow).map((m) => ({ ...m, span })));
  }
  return rows;
}

/**
 * Invariant 4: the last row absorbs leftover columns so the edge is not ragged.
 *
 * The exception matters: a lone non-growing block is left at its own width
 * rather than stretched, because a 1200px-wide KPI tile looks worse than a gap.
 */
function distributeLeftover(row: Member[], cols: number): void {
  const leftover = cols - row.reduce((a, m) => a + m.span, 0);
  if (leftover <= 0) return;

  // A band shares one width. Widen every tile or none: handing a spare column
  // to one tile is how a KPI row ends up visibly ragged.
  const band = row[0]?.bandId;
  if (band && row.every((m) => m.bandId === band)) {
    const each = Math.floor(leftover / row.length);
    if (each > 0) for (const m of row) m.span += each;
    return;
  }

  const growable = row
    .filter((m) => CONTRACTS[m.variant].grow !== "none" && !m.bandId)
    .sort((a, b) => CONTRACTS[b.variant].ideal.w - CONTRACTS[a.variant].ideal.w);

  if (growable.length === 0) return;

  let remaining = leftover;
  let i = 0;
  while (remaining > 0) {
    growable[i % growable.length].span += 1;
    remaining -= 1;
    i += 1;
  }
}

/**
 * Invariant 2: within a row, the widest block is at most three times the
 * narrowest. Past that, width stops reading as hierarchy and reads as a bug.
 */
function enforceWidthRatio(row: Member[], spanPx: (s: number) => number, notes: string[]): void {
  if (row.length < 2) return;

  for (let guard = 0; guard < 12; guard++) {
    const widths = row.map((m) => spanPx(m.span));
    const maxI = widths.indexOf(Math.max(...widths));
    const minI = widths.indexOf(Math.min(...widths));
    if (widths[maxI] <= widths[minI] * 3) return;
    if (row[maxI].span <= 1) return;

    const minContract = CONTRACTS[row[minI].variant];
    // Only move width if the narrow block can actually use it, and never
    // between band members — a band's tiles are equal by construction.
    if (minContract.grow === "none") return;
    if (row[maxI].bandId || row[minI].bandId) return;

    row[maxI].span -= 1;
    row[minI].span += 1;
    if (guard === 0) {
      notes.push("Widths in one row were evened out so the size difference reads as hierarchy, not error.");
    }
  }
}

/**
 * Step the lowest-priority visible block down one rung.
 *
 * Only used by the non-scrolling path. Returns the block list with that block's
 * span reduced, which is enough to make the next solve pass choose a lower rung.
 */
function demoteLowestPriority(
  blocks: Block[],
  placed: PlacedBlock[],
  hidden: Array<{ blockId: string; reason: string }>,
): Block[] {
  const candidates = placed
    .filter((p) => CONTRACTS[p.variant].next !== null)
    .sort((a, b) => CONTRACTS[a.variant].priority - CONTRACTS[b.variant].priority);

  const target = candidates[0];
  if (!target) return blocks;

  void hidden;
  return blocks.map((b) =>
    b.id === target.blockId ? ({ ...b, span: Math.max(2, b.span - 2) } as Block) : b,
  );
}
