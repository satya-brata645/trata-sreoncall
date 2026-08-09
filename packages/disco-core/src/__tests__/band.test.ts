import { test } from "node:test";
import assert from "node:assert/strict";

import { solveLayout } from "../layout";
import type { Block } from "../spec";

/**
 * KPI band geometry.
 *
 * The headline row is the most visible part of a dashboard and the easiest to
 * get subtly wrong: three tiles and an orphan, or two tiles leaving a third of
 * the row empty. Both read as a bug even to someone who could not say why.
 */

const kpi = (id: string): Block => ({
  kind: "kpi", id, span: 3, from: "raw", field: "amount",
  agg: "sum", format: "usd", compare: { mode: "previous", inverse: false },
});

const trend: Block = {
  kind: "timeseries", id: "trend", span: 12, from: "monthly",
  x: "bucket", y: ["amount"], mark: "area", stack: false,
  format: "usd", connectNulls: false, yScale: "linear",
};

const WIDTHS = [468, 520, 600, 700, 800, 900, 1100, 1300, 1600, 1920];

test("a KPI band always fills its row edge to edge", () => {
  // The failure this pins: 4 tiles in a 3-column layout placed 2-per-row, which
  // leaves a third of every row blank while the tiles sit at minimum width.
  for (let n = 1; n <= 8; n++) {
    const blocks = [...Array.from({ length: n }, (_, i) => kpi(`k${i}`)), trend];

    for (const w of WIDTHS) {
      const l = solveLayout(blocks, { w, h: 900 }, {});
      const tiles = l.blocks.filter((b) => b.blockId.startsWith("k"));
      if (tiles.length === 0) continue;

      const contentW = w - 32;
      const byRow = new Map<number, typeof tiles>();
      for (const t of tiles) byRow.set(t.y, [...(byRow.get(t.y) ?? []), t]);

      for (const [y, row] of byRow) {
        const spanned = row.reduce((a, t) => a + t.w, 0) + (row.length - 1) * l.gutter;
        assert.ok(
          Math.abs(spanned - contentW) <= 2,
          `${n} KPIs at ${w}px: row y=${y} spans ${Math.round(spanned)} of ${contentW} available`,
        );
      }
    }
  }
});

test("every tile in a band is the same size", () => {
  for (let n = 1; n <= 8; n++) {
    const blocks = Array.from({ length: n }, (_, i) => kpi(`k${i}`));
    for (const w of WIDTHS) {
      const l = solveLayout(blocks, { w, h: 900 }, {});
      const tiles = l.blocks.filter((b) => b.blockId.startsWith("k"));
      assert.equal(new Set(tiles.map((t) => t.w)).size, 1, `${n} KPIs at ${w}px differ in width`);
      assert.equal(new Set(tiles.map((t) => t.h)).size, 1, `${n} KPIs at ${w}px differ in height`);
    }
  }
});

test("rows in a band all hold the same number of tiles", () => {
  for (let n = 1; n <= 8; n++) {
    const blocks = Array.from({ length: n }, (_, i) => kpi(`k${i}`));
    for (const w of WIDTHS) {
      const l = solveLayout(blocks, { w, h: 900 }, {});
      const counts = new Map<number, number>();
      for (const t of l.blocks) counts.set(t.y, (counts.get(t.y) ?? 0) + 1);
      assert.equal(
        new Set(counts.values()).size,
        1,
        `${n} KPIs at ${w}px split as ${[...counts.values()].join("/")} — an orphan row`,
      );
    }
  }
});

test("four tiles land on one row as soon as four fit", () => {
  // 12 columns of a 1600px window is ~130 each; four tiles at span 3 is the
  // canonical headline row and should not need a wider window than that.
  const blocks = Array.from({ length: 4 }, (_, i) => kpi(`k${i}`));
  const l = solveLayout(blocks, { w: 1600, h: 900 }, {});
  assert.equal(new Set(l.blocks.map((b) => b.y)).size, 1, "four tiles should share one row at 1600px");
});

test("at the OS window floor the band still fills the row", () => {
  const blocks = Array.from({ length: 4 }, (_, i) => kpi(`k${i}`));
  const l = solveLayout(blocks, { w: 436, h: 176 }, {});
  const contentW = 436 - 32;
  const rows = new Map<number, typeof l.blocks>();
  for (const t of l.blocks) rows.set(t.y, [...(rows.get(t.y) ?? []), t]);

  for (const [, row] of rows) {
    // Gutters are part of the row: two 196px tiles with a 12px gap fill 404,
    // and omitting the gap makes a correct layout look 12px short.
    const spanned = row.reduce((a, t) => a + t.w, 0) + (row.length - 1) * l.gutter;
    assert.ok(Math.abs(spanned - contentW) <= 2, `row spans ${Math.round(spanned)} of ${contentW}`);
  }
});
