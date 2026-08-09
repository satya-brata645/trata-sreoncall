import { cn } from "@/lib/utils";

/**
 * The desktop canvas — the base surface the whole OS sits on top of.
 *
 * This is deliberately the least possible thing: a full-bleed, theme-aware
 * graph-paper grid and a positioning context. It owns no chrome, no nav, no
 * content. Everything that lands on the desktop later (icons, windows, the
 * chat panel the agent stages) composes *into* it as children.
 *
 * The grid itself lives in `.os-canvas` in globals.css rather than here,
 * because it is a stack of three backgrounds — a radial wash over two
 * hairline gradients — which Tailwind can only express as arbitrary values
 * that would drift from the token chain.
 *
 * `cellSize` accepts a spacing token value (e.g. `var(--spacing-md)`); the
 * grid is driven by a custom property so a zoom control can rescale it later
 * without this component knowing about zoom.
 */
export interface DesktopCanvasProps {
  children?: React.ReactNode;
  /** Extra classes for the canvas surface itself. */
  className?: string;
  /**
   * Grid cell size. Pass a spacing token (`var(--spacing-md)`), not a raw px
   * value. Defaults to `--dos-canvas-cell` (36px), which `OS_GRID_CELL` in
   * `lib/os/constants.ts` must be kept equal to — window cascade is computed in
   * JS and would land between lines otherwise.
   */
  cellSize?: string;
  /**
   * Accepted and ignored. The DOS lattice is a single fixed white-alpha step
   * (`--dos-canvas-line`), because a canvas whose line weight can be turned up
   * stops being wallpaper and starts competing with the windows on it. Kept on
   * the type so the ported call sites still compile.
   */
  lineStrength?: string;
}

export function DesktopCanvas({
  children,
  className,
  cellSize,
}: DesktopCanvasProps) {
  return (
    <div
      // `relative` makes this the positioning context for everything dropped
      // onto the desktop. `overflow-hidden` keeps a window dragged past the
      // edge from scrolling the page — the desktop is a fixed stage, not a
      // document.
      className={cn(
        "os-canvas relative h-full w-full overflow-hidden",
        "bg-role-surface-page",
        className,
      )}
      style={
        {
          ...(cellSize ? { "--os-canvas-cell": cellSize } : {}),
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
