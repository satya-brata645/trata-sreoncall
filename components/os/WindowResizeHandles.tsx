"use client";

import { OS_WINDOW_RESIZE } from "@/lib/os/constants";
import type { OsResizeEdge } from "@/lib/os/geometry";

const { edge: E, corner: C } = OS_WINDOW_RESIZE;

/**
 * The eight resize targets, declared once.
 *
 * Geometry is inline `style` rather than Tailwind classes on purpose: these are
 * pointer hit areas derived from `OS_WINDOW_RESIZE`, not visual design, so
 * arbitrary-value classes would duplicate the constant and drift from it.
 * Cursors use standard Tailwind utilities.
 *
 * Corners are declared after edges so they paint on top and win the overlap —
 * dragging a corner should resize two boundaries, not one.
 */
const HANDLES: ReadonlyArray<{
  edge: OsResizeEdge;
  label: string;
  cursor: string;
  style: React.CSSProperties;
}> = [
  { edge: "n", label: "top", cursor: "cursor-ns-resize", style: { top: 0, left: 0, right: 0, height: E } },
  { edge: "s", label: "bottom", cursor: "cursor-ns-resize", style: { bottom: 0, left: 0, right: 0, height: E } },
  { edge: "w", label: "left", cursor: "cursor-ew-resize", style: { left: 0, top: 0, bottom: 0, width: E } },
  { edge: "e", label: "right", cursor: "cursor-ew-resize", style: { right: 0, top: 0, bottom: 0, width: E } },
  { edge: "nw", label: "top left", cursor: "cursor-nwse-resize", style: { top: 0, left: 0, width: C, height: C } },
  { edge: "ne", label: "top right", cursor: "cursor-nesw-resize", style: { top: 0, right: 0, width: C, height: C } },
  { edge: "sw", label: "bottom left", cursor: "cursor-nesw-resize", style: { bottom: 0, left: 0, width: C, height: C } },
  { edge: "se", label: "bottom right", cursor: "cursor-nwse-resize", style: { bottom: 0, right: 0, width: C, height: C } },
];

export interface WindowResizeHandlesProps {
  /** Window title, used to label each handle for assistive tech. */
  title: string;
  onResizeStart: (edge: OsResizeEdge, e: React.PointerEvent<HTMLElement>) => void;
}

/**
 * Invisible drag targets sitting on a window's boundaries. Purely an input
 * surface — all geometry maths lives in `lib/os/geometry.ts`, and the active
 * drag is owned by `OsWindow`.
 */
export function WindowResizeHandles({
  title,
  onResizeStart,
}: WindowResizeHandlesProps) {
  return (
    <>
      {HANDLES.map((handle) => (
        <div
          key={handle.edge}
          // Marks the target as non-draggable for the title bar's move handler,
          // so a corner drag never also moves the window.
          data-os-window-no-drag
          role="separator"
          aria-label={`Resize ${title} from ${handle.label}`}
          aria-orientation={
            handle.edge === "n" || handle.edge === "s" ? "horizontal" : "vertical"
          }
          className={`absolute z-10 touch-none ${handle.cursor}`}
          style={handle.style}
          onPointerDown={(e) => onResizeStart(handle.edge, e)}
        />
      ))}
    </>
  );
}
