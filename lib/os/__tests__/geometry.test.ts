import { test } from "node:test";
import assert from "node:assert/strict";

import { snapRect } from "../geometry";
import { OS_MENU_BAR_HEIGHT } from "../constants";

const BOUNDS = { width: 1600, height: 900 };
const DOCK_INSET = 72;
const FULL_INSET = { left: DOCK_INSET, top: OS_MENU_BAR_HEIGHT };

/**
 * The menu bar carries the agent's mode control, so a window arranged on top of
 * it has covered the user's way of stopping the agent. Every preset has to
 * respect the strip — including the ones that reach the top edge, which is
 * exactly where the bug would hide.
 */
const TOP_REACHING = [
  "fill",
  "left-half",
  "right-half",
  "top-half",
  "top-left-quarter",
  "top-right-quarter",
] as const;

for (const preset of TOP_REACHING) {
  test(`snapRect: ${preset} starts below the menu bar`, () => {
    const rect = snapRect(preset, BOUNDS, FULL_INSET);
    assert.ok(
      rect.y >= OS_MENU_BAR_HEIGHT,
      `${preset} placed a window at y=${rect.y}, under the menu bar`,
    );
  });
}

test("snapRect: bottom-reaching presets still end at the viewport edge", () => {
  for (const preset of ["fill", "bottom-half", "left-half"] as const) {
    const rect = snapRect(preset, BOUNDS, FULL_INSET);
    assert.equal(
      rect.y + rect.height,
      BOUNDS.height,
      `${preset} left a gap at the bottom`,
    );
  }
});

test("snapRect: halves split the usable height, not the raw viewport", () => {
  const usable = BOUNDS.height - OS_MENU_BAR_HEIGHT;
  const top = snapRect("top-half", BOUNDS, FULL_INSET);
  const bottom = snapRect("bottom-half", BOUNDS, FULL_INSET);
  assert.equal(top.height, Math.round(usable / 2));
  // Adjacent arrangements must meet exactly — a rounding gap shows as a
  // hairline of desktop between two tiled windows.
  assert.equal(top.y + top.height, bottom.y);
});

test("snapRect: every preset clears the dock column", () => {
  for (const preset of [
    "fill",
    "left-half",
    "top-left-quarter",
    "bottom-left-quarter",
  ] as const) {
    assert.ok(snapRect(preset, BOUNDS, FULL_INSET).x >= DOCK_INSET);
  }
});

test("snapRect: the top inset is optional, so existing callers are unaffected", () => {
  const withoutTop = snapRect("fill", BOUNDS, { left: DOCK_INSET });
  assert.equal(withoutTop.y, 0);
  assert.equal(withoutTop.height, BOUNDS.height);
});

test("snapRect: left and right halves meet exactly", () => {
  const left = snapRect("left-half", BOUNDS, FULL_INSET);
  const right = snapRect("right-half", BOUNDS, FULL_INSET);
  assert.equal(left.x + left.width, right.x);
  assert.equal(right.x + right.width, BOUNDS.width);
});
