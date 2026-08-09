import { OS_MENU_BAR_HEIGHT, OS_WINDOW_MIN_SIZE } from "./constants";

/** A window rectangle in desktop-local px. */
export interface OsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which boundary is being dragged. Compound values are corners, so `"nw"`
 * resizes the top and left boundaries together.
 */
export type OsResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Viewport bounds a window must stay inside. */
export interface OsBounds {
  width: number;
  height: number;
}

/**
 * Default rectangle for a newly opened window.
 *
 * Large enough to be useful immediately, but deliberately not "fill the whole
 * workspace": if a fresh window leaves no canvas visible around it, the
 * desktop stops reading as a place you can arrange things and starts reading as
 * a single-page app with ornamental chrome.
 */
export function openWindowRect(
  bounds: OsBounds,
  options: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    cascadeOffset: number;
    widthRatio: number;
    heightRatio: number;
  },
): OsRect {
  const x = options.left + options.cascadeOffset;
  const y = options.top + options.cascadeOffset;
  const usableWidth = bounds.width - options.left - options.right;
  const usableHeight = bounds.height - options.top - options.bottom;
  const availableWidth = bounds.width - x - options.right;
  const availableHeight = bounds.height - y - options.bottom;

  const targetWidth = Math.round(usableWidth * options.widthRatio);
  const targetHeight = Math.round(usableHeight * options.heightRatio);

  return {
    x,
    y,
    width: Math.max(
      OS_WINDOW_MIN_SIZE.width,
      Math.min(availableWidth, targetWidth),
    ),
    height: Math.max(
      OS_WINDOW_MIN_SIZE.height,
      Math.min(availableHeight, targetHeight),
    ),
  };
}

/**
 * Compute the rectangle produced by dragging one boundary of `start` by
 * (`dx`, `dy`).
 *
 * Works in edge coordinates (left/top/right/bottom) rather than
 * position-plus-size, because dragging the north or west boundary changes both
 * the origin *and* the size — expressing that as x/width arithmetic is where
 * off-by-one and jitter bugs come from.
 *
 * Order of operations matters: clamp to the viewport first, then enforce the
 * minimum size. Doing it the other way round lets a window that has hit the
 * viewport edge keep shrinking its opposite boundary.
 *
 * Pure function, so the resize behaviour is inspectable without a browser.
 */
export function resizeRect(
  start: OsRect,
  edge: OsResizeEdge,
  dx: number,
  dy: number,
  bounds: OsBounds,
): OsRect {
  const movesWest = edge.includes("w");
  const movesEast = edge.includes("e");
  const movesNorth = edge.includes("n");
  const movesSouth = edge.includes("s");

  let left = movesWest ? start.x + dx : start.x;
  let top = movesNorth ? start.y + dy : start.y;
  let right = movesEast ? start.x + start.width + dx : start.x + start.width;
  let bottom = movesSouth ? start.y + start.height + dy : start.y + start.height;

  // Keep every boundary on screen.
  left = Math.max(0, left);
  top = Math.max(OS_MENU_BAR_HEIGHT, top);
  right = Math.min(bounds.width, right);
  bottom = Math.min(bounds.height, bottom);

  // Enforce the minimum by pushing back the boundary the user is dragging, so
  // the opposite (stationary) boundary stays put and the window doesn't drift.
  if (right - left < OS_WINDOW_MIN_SIZE.width) {
    if (movesWest) left = right - OS_WINDOW_MIN_SIZE.width;
    else right = left + OS_WINDOW_MIN_SIZE.width;
  }
  if (bottom - top < OS_WINDOW_MIN_SIZE.height) {
    if (movesNorth) top = bottom - OS_WINDOW_MIN_SIZE.height;
    else bottom = top + OS_WINDOW_MIN_SIZE.height;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A one-click window arrangement.
 *
 * Names describe the region of the desktop the window fills, so they read the
 * same in the menu and in code.
 */
export type OsSnapPreset =
  | "left-half"
  | "right-half"
  | "top-half"
  | "bottom-half"
  | "fill"
  | "top-left-quarter"
  | "top-right-quarter"
  | "bottom-left-quarter"
  | "bottom-right-quarter";

/**
 * Fraction of the desktop each preset occupies, as `[x, y, width, height]` in
 * the unit square. Declared as data so adding an arrangement (thirds, say) is
 * one row here plus one menu entry — no branching logic.
 */
const SNAP_FRACTIONS: Record<OsSnapPreset, readonly [number, number, number, number]> = {
  "left-half": [0, 0, 0.5, 1],
  "right-half": [0.5, 0, 0.5, 1],
  "top-half": [0, 0, 1, 0.5],
  "bottom-half": [0, 0.5, 1, 0.5],
  fill: [0, 0, 1, 1],
  "top-left-quarter": [0, 0, 0.5, 0.5],
  "top-right-quarter": [0.5, 0, 0.5, 0.5],
  "bottom-left-quarter": [0, 0.5, 0.5, 0.5],
  "bottom-right-quarter": [0.5, 0.5, 0.5, 0.5],
};

/**
 * Rectangle for a snap preset within `bounds`.
 *
 * `inset` reserves the chrome a window must not slide under: the dock at the
 * left edge, and the menu bar along the top. Results are rounded to whole
 * pixels — fractional geometry makes adjacent snapped windows show a hairline
 * gap or overlap.
 *
 * Both insets matter and for the same reason. A window under the dock is
 * annoying; a window under the menu bar has covered the agent's mode control,
 * which is the user's way of stopping it.
 *
 * Pure function, so every arrangement is verifiable without a browser.
 */
export function snapRect(
  preset: OsSnapPreset,
  bounds: OsBounds,
  inset: { left: number; top?: number } = { left: 0 },
): OsRect {
  const [fx, fy, fw, fh] = SNAP_FRACTIONS[preset];
  const top = inset.top ?? 0;
  // Every preset — Fill included — respects the reservations, because these are
  // *window arrangements*, not full screen. Fill sizes a normal window to the
  // desktop work area; true full screen is a separate mode that bypasses
  // `snapRect` entirely and takes the whole viewport.
  const usableWidth = bounds.width - inset.left;
  const usableHeight = bounds.height - top;
  const x = Math.round(inset.left + fx * usableWidth);
  const width = Math.round(fw * usableWidth);
  const y = Math.round(top + fy * usableHeight);
  const height = Math.round(fh * usableHeight);

  return {
    x,
    y,
    width: Math.max(OS_WINDOW_MIN_SIZE.width, width),
    height: Math.max(OS_WINDOW_MIN_SIZE.height, height),
  };
}

/**
 * Compute the rectangle produced by dragging a window body by (`dx`, `dy`).
 *
 * Size never changes; the origin is clamped so at least a minimum-sized patch
 * of the window — which always includes the title bar — stays reachable.
 */
export function moveRect(
  start: OsRect,
  dx: number,
  dy: number,
  bounds: OsBounds,
): OsRect {
  const maxX = Math.max(0, bounds.width - OS_WINDOW_MIN_SIZE.width);
  const minY = OS_MENU_BAR_HEIGHT;
  const maxY = Math.max(minY, bounds.height - OS_WINDOW_MIN_SIZE.height);
  return {
    ...start,
    x: Math.min(Math.max(0, start.x + dx), maxX),
    y: Math.min(Math.max(minY, start.y + dy), maxY),
  };
}
