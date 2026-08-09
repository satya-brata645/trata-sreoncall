/**
 * Shared OS geometry. Single source of truth for anything the window manager,
 * the dock and the canvas all need to agree on.
 */

/**
 * Desktop grid cell, in px.
 *
 * MUST match `--dos-canvas-cell` in tokens.css. Windows cascade in multiples of
 * this so a freshly opened window lands on the visible grid rather than between
 * lines. Kept in TS because window geometry is computed in JS; the CSS keeps
 * using the token.
 */
export const OS_GRID_CELL = 36;

/** Gap between the dock rail and the viewport edge, in grid cells. */
export const OS_DOCK_INSET_CELLS = 1;

/**
 * Height of the menu bar, in px.
 *
 * The desktop's only permanent chrome, and the strip every window arrangement
 * must stay below — the mode control and the agent's status live up there, so a
 * window covering it would cover the user's off-switch.
 *
 * Deliberately not a grid multiple: it is a chrome band, not a canvas cell.
 * MUST match `--dos-menu-bar-height` in tokens.css.
 */
export const OS_MENU_BAR_HEIGHT = 48;

/**
 * Opening geometry.
 *
 * Windows open filling most of the desktop rather than at a fixed size: an app
 * you just launched is the thing you want to look at, and a small window on a
 * large display means an immediate resize before you can work.
 *
 * `leftCells` clears the dock rail (its own inset plus its width); the other
 * margins are the breathing room that keeps the canvas grid visible around the
 * window, so it still reads as sitting *on* a desktop rather than replacing it.
 */
export const OS_WINDOW_OPEN_MARGIN_CELLS = {
  left: OS_DOCK_INSET_CELLS + 2,
  top: 1,
  right: 1,
  bottom: 1,
} as const;

/**
 * Each additional window opens one cell down-right of the last, so stacked
 * windows stay individually grabbable instead of hiding one another exactly.
 * The offset is subtracted from the size, so a cascaded window still fits.
 */
export const OS_WINDOW_CASCADE = {
  stepCells: 1,
  /** After this many steps the cascade wraps back to the origin. */
  maxSteps: 4,
} as const;

/** Smallest a window may be, in px — below this the title bar stops being usable. */
export const OS_WINDOW_MIN_SIZE = {
  width: OS_GRID_CELL * 13,
  height: OS_GRID_CELL * 8,
} as const;

/** Base stacking index for windows, so they always sit above the canvas. */
export const OS_WINDOW_BASE_Z = 10;

/**
 * Stacking index for the dock.
 *
 * Window z-indexes increase by one on every open and every focus, so a long
 * session climbs steadily. This sits far above any reachable window value: the
 * dock must never end up beneath a window, or it becomes unclickable — and a
 * full-screen window is drawn over the dock's column by design, relying on the
 * dock floating above it.
 */
export const OS_DOCK_Z = 100000;

/**
 * Resize hit areas, in px.
 *
 * These are pointer targets rather than visual design, so they are not spacing
 * tokens — but they live here so the handles and any future affordance (a
 * corner grip, say) stay in agreement. Edges are deliberately a little wider
 * than the 1px border: a hairline target is unusable with a mouse, and corners
 * need to win over the two edges they overlap.
 */
export const OS_WINDOW_RESIZE = {
  edge: 6,
  corner: 14,
} as const;
