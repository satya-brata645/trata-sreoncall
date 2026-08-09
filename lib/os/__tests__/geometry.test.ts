import { test } from "node:test";
import assert from "node:assert/strict";

import { moveRect, openWindowRect, resizeRect, snapRect } from "../geometry";
import { OS_MENU_BAR_HEIGHT, OS_WINDOW_MIN_SIZE } from "../constants";

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

test("openWindowRect: opens below reserved chrome as a free-floating pane", () => {
  const rect = openWindowRect(BOUNDS, {
    left: DOCK_INSET,
    top: OS_MENU_BAR_HEIGHT + 36,
    right: 36,
    bottom: 36,
    cascadeOffset: 0,
    widthRatio: 0.72,
    heightRatio: 0.78,
  });

  assert.equal(rect.x, DOCK_INSET);
  assert.equal(rect.y, OS_MENU_BAR_HEIGHT + 36);
  assert.ok(rect.width < BOUNDS.width - DOCK_INSET - 36);
  assert.ok(rect.height < BOUNDS.height - (OS_MENU_BAR_HEIGHT + 36) - 36);
  assert.ok(rect.width >= OS_WINDOW_MIN_SIZE.width);
  assert.ok(rect.height >= OS_WINDOW_MIN_SIZE.height);
});

test("openWindowRect: later cascade steps stay within the desktop work area", () => {
  const rect = openWindowRect(BOUNDS, {
    left: DOCK_INSET,
    top: OS_MENU_BAR_HEIGHT + 36,
    right: 36,
    bottom: 36,
    cascadeOffset: 108,
    widthRatio: 0.72,
    heightRatio: 0.78,
  });

  assert.equal(rect.x, DOCK_INSET + 108);
  assert.equal(rect.y, OS_MENU_BAR_HEIGHT + 36 + 108);
  assert.ok(rect.x + rect.width <= BOUNDS.width - 36);
  assert.ok(rect.y + rect.height <= BOUNDS.height - 36);
});

test("moveRect: a free-floating window cannot be dragged under the menu bar", () => {
  const rect = moveRect(
    { x: 120, y: OS_MENU_BAR_HEIGHT + 24, width: 720, height: 520 },
    0,
    -400,
    BOUNDS,
  );

  assert.equal(rect.y, OS_MENU_BAR_HEIGHT);
});

test("resizeRect: the north edge cannot be pulled under the menu bar", () => {
  const rect = resizeRect(
    { x: 120, y: OS_MENU_BAR_HEIGHT + 60, width: 720, height: 520 },
    "n",
    0,
    -400,
    BOUNDS,
  );

  assert.equal(rect.y, OS_MENU_BAR_HEIGHT);
});
