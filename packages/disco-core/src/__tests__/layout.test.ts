import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { solveLayout, type Layout, type LayoutHints } from "../layout";
import { CONTRACTS, TOP_VARIANT, rungIndex, type BlockVariant } from "../contracts";
import type { Block, DashboardSpec } from "../spec";

/**
 * The solver is the piece with the most ways to be subtly wrong, and every one
 * of them is visible to the user: a chart that strobes while you drag, three
 * KPI tiles and an orphan, a "trend" too short to show a trend.
 *
 * These tests are written against the *invariants* rather than against
 * particular pixel outputs, so tuning a contract does not invalidate them.
 */

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const kpi = (id: string): Block => ({
  kind: "kpi", id, span: 3, from: "raw", field: "amount",
  agg: "sum", format: "usd", compare: { mode: "previous", inverse: false },
});

const trend: Block = {
  kind: "timeseries", id: "trend", span: 8, from: "monthly",
  x: "bucket", y: ["amount"], mark: "area", stack: false,
  format: "usd", connectNulls: false, yScale: "linear",
};

const bars: Block = {
  kind: "bar", id: "bars", span: 6, from: "by_region",
  x: "region", y: ["amount"], orientation: "vertical", stack: false, format: "usd",
};

const donut: Block = {
  kind: "pie", id: "donut", span: 4, from: "by_region",
  category: "region", value: "amount", donut: true, format: "usd",
};

const points: Block = {
  kind: "scatter", id: "points", span: 6, from: "raw",
  x: "amount", y: "seats", xScale: "linear", yScale: "linear",
};

const detail: Block = {
  kind: "table", id: "detail", span: 12, from: "raw",
  columns: [{ field: "a" }, { field: "b" }, { field: "c" }], pageSize: 25, virtualize: true,
};

const FULL: Block[] = [kpi("k1"), kpi("k2"), kpi("k3"), kpi("k4"), trend, donut, bars, points, detail];

const HINTS: LayoutHints = {
  trend: { rowCount: 52, categoryCount: 0, seriesCount: 1, maxLabelChars: 6 },
  bars: { rowCount: 7, categoryCount: 7, seriesCount: 1, maxLabelChars: 11 },
  donut: { rowCount: 4, categoryCount: 4, seriesCount: 1, maxLabelChars: 13 },
  points: { rowCount: 4200, categoryCount: 0, seriesCount: 1, maxLabelChars: 8 },
  detail: { rowCount: 4200, categoryCount: 0, seriesCount: 1, maxLabelChars: 10 },
};

/** The DOS window floor, minus window chrome and Disco's own header. */
const FLOOR = { w: 436, h: 176 };

const placedIn = (l: Layout, id: string) => l.blocks.find((b) => b.blockId === id);

/* ------------------------------------------------------------------ *
 * Purity and determinism
 * ------------------------------------------------------------------ */

test("the solver is deterministic — identical inputs, identical output", () => {
  const a = solveLayout(FULL, { w: 1200, h: 800 }, HINTS);
  const b = solveLayout(FULL, { w: 1200, h: 800 }, HINTS);
  assert.deepEqual(a, b);
});

test("the solver module reads no clock and no randomness", () => {
  // A layout that depends on wall-clock time cannot be snapshot-tested and
  // desyncs server rendering from client hydration.
  const src = readFileSync(join(import.meta.dirname, "../layout.ts"), "utf8");
  assert.ok(!/Date\.now\(|new Date\(|Math\.random\(/.test(src));
});

test("the solver never mutates the blocks it is given", () => {
  const spans = FULL.map((b) => b.span);
  solveLayout(FULL, { w: 700, h: 500 }, HINTS);
  assert.deepEqual(FULL.map((b) => b.span), spans);
});

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

test("no block ever exceeds the content width", () => {
  for (const w of [468, 600, 900, 1200, 1600, 1920]) {
    const l = solveLayout(FULL, { w, h: 900 }, HINTS);
    const contentW = w - 32;
    for (const p of l.blocks) {
      assert.ok(p.x + p.w <= contentW + 1, `${p.blockId} overflows at ${w}px: ${p.x}+${p.w} > ${contentW}`);
    }
  }
});

test("the surface never scrolls horizontally, at any width", () => {
  // A dashboard that scrolls sideways inside a window is broken, not responsive:
  // the user resized the window precisely so they would not have to.
  for (let w = 300; w <= 2000; w += 13) {
    const l = solveLayout(FULL, { w, h: 800 }, HINTS);
    const contentW = w - 32;
    const rightmost = Math.max(0, ...l.blocks.map((b) => b.x + b.w));
    assert.ok(rightmost <= contentW + 1, `content reaches ${Math.round(rightmost)} of ${contentW} at ${w}px`);
  }
});

test("blocks never overlap", () => {
  for (const w of [468, 720, 1100, 1500]) {
    const l = solveLayout(FULL, { w, h: 900 }, HINTS);
    for (let i = 0; i < l.blocks.length; i++) {
      for (let j = i + 1; j < l.blocks.length; j++) {
        const a = l.blocks[i];
        const b = l.blocks[j];
        const disjoint =
          a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
        assert.ok(disjoint, `${a.blockId} overlaps ${b.blockId} at ${w}px`);
      }
    }
  }
});

test("every block is either placed or explicitly hidden, never dropped", () => {
  for (const w of [468, 800, 1440]) {
    const l = solveLayout(FULL, { w, h: 700 }, HINTS);
    const accounted = new Set([...l.blocks.map((b) => b.blockId), ...l.hidden.map((h) => h.blockId)]);
    for (const b of FULL) assert.ok(accounted.has(b.id), `${b.id} vanished at ${w}px`);
  }
});

test("a placed block always meets its variant's minimum size", () => {
  for (const w of [468, 560, 900, 1400]) {
    const l = solveLayout(FULL, { w, h: 900 }, HINTS);
    for (const p of l.blocks) {
      const c = CONTRACTS[p.variant];
      assert.ok(p.w >= c.min.w - 1, `${p.blockId} is ${p.w}px wide, under ${c.min.w} for ${p.variant}`);
      assert.ok(p.h >= c.min.h - 1, `${p.blockId} is ${p.h}px tall, under ${c.min.h} for ${p.variant}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * The window floor — the case the whole design exists for
 * ------------------------------------------------------------------ */

test("at the 468x288 window floor, the headline and the trend both survive", () => {
  const l = solveLayout(FULL, FLOOR, HINTS);
  const hiddenIds = new Set(l.hidden.map((h) => h.blockId));

  assert.ok(!hiddenIds.has("k1"), "a KPI must never be hidden — it is the headline");
  assert.ok(!hiddenIds.has("trend"), "the trend is the highest-priority chart");

  for (const p of l.blocks) {
    const c = CONTRACTS[p.variant];
    assert.ok(p.w >= c.min.w - 1 && p.h >= c.min.h - 1, `${p.blockId} illegible at the floor`);
  }
});

test("the shipped orders dashboard lays out at the floor without illegible blocks", () => {
  const path = join(import.meta.dirname, "../../../../outputs/orders/spec.json");
  let spec: DashboardSpec;
  try {
    spec = JSON.parse(readFileSync(path, "utf8")) as DashboardSpec;
  } catch {
    return; // fixture not generated in this checkout
  }

  const l = solveLayout(spec.blocks, FLOOR, {});
  for (const p of l.blocks) {
    const c = CONTRACTS[p.variant];
    assert.ok(p.w >= c.min.w - 1, `${p.blockId} (${p.variant}) is ${p.w}px, under ${c.min.w}`);
  }
});

/* ------------------------------------------------------------------ *
 * Invariant 1 — KPI band atomicity
 * ------------------------------------------------------------------ */

test("KPI tiles are never orphaned: every tile in a band shares a row height", () => {
  for (let n = 1; n <= 8; n++) {
    const blocks = [...Array.from({ length: n }, (_, i) => kpi(`k${i}`)), trend];
    for (const w of [468, 600, 760, 980, 1280, 1600]) {
      const l = solveLayout(blocks, { w, h: 900 }, HINTS);
      const tiles = l.blocks.filter((b) => b.blockId.startsWith("k"));
      if (tiles.length === 0) continue;

      // Rows must be equal-sized: never "three then one".
      const byRow = new Map<number, number>();
      for (const t of tiles) byRow.set(t.y, (byRow.get(t.y) ?? 0) + 1);
      const counts = [...byRow.values()];
      assert.equal(
        new Set(counts).size,
        1,
        `${n} KPIs at ${w}px split unevenly across rows: ${counts.join("/")}`,
      );

      // And every tile is the same size as its neighbours.
      assert.equal(new Set(tiles.map((t) => t.w)).size, 1, `${n} KPIs at ${w}px have differing widths`);
      assert.equal(new Set(tiles.map((t) => t.h)).size, 1, `${n} KPIs at ${w}px have differing heights`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Invariant 2 — width ratio ceiling
 * ------------------------------------------------------------------ */

test("within a row the widest block is at most three times the narrowest", () => {
  for (const w of [600, 900, 1200, 1600]) {
    const l = solveLayout(FULL, { w, h: 900 }, HINTS);
    const rows = new Map<number, number[]>();
    for (const p of l.blocks) rows.set(p.y, [...(rows.get(p.y) ?? []), p.w]);
    for (const [, widths] of rows) {
      if (widths.length < 2) continue;
      assert.ok(
        Math.max(...widths) <= Math.min(...widths) * 3 + 1,
        `width ratio ${Math.max(...widths) / Math.min(...widths)} at ${w}px`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * Invariant 3 — aspect band
 * ------------------------------------------------------------------ */

test("charts stay inside their aspect band, so slope is never flattened or exaggerated", () => {
  for (const w of [500, 900, 1400, 1920]) {
    const l = solveLayout(FULL, { w, h: 900 }, HINTS);
    for (const p of l.blocks) {
      const band = CONTRACTS[p.variant].aspect;
      if (!band) continue;
      const ratio = p.h / p.w;
      assert.ok(
        ratio >= band.lo - 0.15 && ratio <= band.hi + 0.15,
        `${p.blockId} aspect ${ratio.toFixed(2)} outside [${band.lo}, ${band.hi}] at ${w}px`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * Invariant 8 — priority monotonicity
 * ------------------------------------------------------------------ */

test("a high-priority block is never degraded further than a low-priority one", () => {
  for (const w of [468, 520, 640, 820, 1100]) {
    const l = solveLayout(FULL, { w, h: 700 }, HINTS);
    for (const a of l.blocks) {
      for (const b of l.blocks) {
        const pa = CONTRACTS[a.variant].priority;
        const pb = CONTRACTS[b.variant].priority;
        if (pa <= pb) continue;
        assert.ok(
          rungIndex(a.variant) <= rungIndex(b.variant) + 1,
          `at ${w}px ${a.blockId} (priority ${pa}) is more degraded than ${b.blockId} (priority ${pb})`,
        );
      }
    }
  }
});

test("scatter hides rather than degrades — a summarised cloud is a different claim", () => {
  assert.equal(CONTRACTS.scatter.next, null);
});

test("a KPI can always degrade rather than disappear", () => {
  let v: BlockVariant | null = TOP_VARIANT.kpi;
  const rungs: BlockVariant[] = [];
  while (v) {
    rungs.push(v);
    v = CONTRACTS[v].next;
  }
  assert.deepEqual(rungs, ["kpi", "kpi.compact", "kpi.inline"]);
});

/* ------------------------------------------------------------------ *
 * Invariant 9 — hysteresis, the anti-flicker guarantee
 * ------------------------------------------------------------------ */

test("dragging a window wider never flickers a block between two forms", () => {
  // Sweep the full range one pixel at a time, feeding each result back in as
  // `previous`, exactly as the renderer does. A block may change form at a
  // threshold, but it must not oscillate.
  const blocks = [trend, bars, donut];
  const transitions = new Map<string, number>();
  let previous: Layout | undefined;

  for (let w = 468; w <= 1400; w++) {
    const l = solveLayout(blocks, { w, h: 700 }, HINTS, { previous });
    if (previous) {
      for (const p of l.blocks) {
        const before = previous.blocks.find((q) => q.blockId === p.blockId);
        if (before && before.variant !== p.variant) {
          transitions.set(p.blockId, (transitions.get(p.blockId) ?? 0) + 1);
        }
      }
    }
    previous = l;
  }

  for (const [id, n] of transitions) {
    assert.ok(n <= 3, `${id} changed form ${n} times across one monotone drag — that is flicker`);
  }
});

test("degrading is always explained", () => {
  const l = solveLayout(FULL, FLOOR, HINTS);
  for (const p of l.blocks) {
    if (p.degradedFrom) {
      assert.ok(p.degradeReason && p.degradeReason.length > 10, `${p.blockId} degraded without a reason`);
    }
  }
  for (const h of l.hidden) {
    assert.ok(h.reason.length > 10, `${h.blockId} hidden without a reason`);
  }
});

/* ------------------------------------------------------------------ *
 * Columns
 * ------------------------------------------------------------------ */

test("column counts divide 12, so spans never drift as the window resizes", () => {
  // This is what keeps a span-8 block exactly two-thirds of the row at every
  // size. With 5 or 7 columns the hierarchy would shift while dragging.
  for (let w = 468; w <= 2000; w += 17) {
    const l = solveLayout(FULL, { w, h: 800 }, HINTS);
    assert.ok([1, 2, 3, 4, 6, 12].includes(l.cols), `got ${l.cols} columns at ${w}px`);
  }
});

test("column count never decreases as the window grows", () => {
  let last = 0;
  for (let w = 468; w <= 2000; w += 4) {
    const l = solveLayout(FULL, { w, h: 800 }, HINTS);
    assert.ok(l.cols >= last, `columns dropped from ${last} to ${l.cols} at ${w}px`);
    last = l.cols;
  }
});

/* ------------------------------------------------------------------ *
 * Affordances
 * ------------------------------------------------------------------ */

test("a single-series chart gets no legend — the title already names it", () => {
  const l = solveLayout([trend], { w: 1200, h: 700 }, HINTS);
  assert.equal(placedIn(l, "trend")!.affordances.legend, false);
});

test("a multi-series chart gets a legend when there is room for one", () => {
  const multi: Block = { ...trend, y: ["amount", "seats", "tickets"] };
  const hints: LayoutHints = { trend: { rowCount: 52, categoryCount: 0, seriesCount: 3, maxLabelChars: 6 } };
  const l = solveLayout([multi], { w: 1200, h: 700 }, hints);
  assert.equal(placedIn(l, "trend")!.affordances.legend, true);
});

test("at the OS window floor a lone trend keeps its axes", () => {
  // Worth pinning: 468px of window is 436 of content, which is 3 columns of
  // ~137. A full-width trend gets 404px — comfortably over its 280 minimum —
  // so the floor does NOT force degradation. Degradation is for embeds and
  // side-by-side rows, not for every small window.
  const l = solveLayout([trend], FLOOR, HINTS);
  assert.equal(l.blocks[0].variant, "timeseries");
  assert.equal(l.blocks[0].affordances.xAxis, true);
});

test("axes drop out before the chart does", () => {
  const wide = solveLayout([trend], { w: 1200, h: 700 }, HINTS);
  assert.equal(wide.blocks[0].variant, "timeseries");
  assert.equal(wide.blocks[0].affordances.xAxis, true);

  // A narrow embed — a side panel, not an OS window — is where the ladder bites.
  const narrow = solveLayout([trend], { w: 260, h: 400 }, HINTS);
  assert.equal(narrow.blocks[0].variant, "timeseries.sparkline");
  assert.equal(narrow.blocks[0].affordances.xAxis, false, "a sparkline has no axes by definition");
  assert.ok(narrow.blocks[0].degradeReason, "and it says why");
});
