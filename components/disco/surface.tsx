"use client";

import * as React from "react";

import { runPipeline, type Frame, type Row } from "@disco/core/algebra";
import { layoutHints, solveLayout, type Layout, type Rect } from "@disco/core/layout";
import type { DashboardSpec } from "@disco/core/spec";

import { DiscoBlock } from "./blocks";

/**
 * The surface — a spec rendered into a rectangle.
 *
 * It knows nothing about viewports, breakpoints or pages. Give it a rect and it
 * asks the solver what fits; that is what lets the same component render at
 * 1920px on a desktop, at 468px in an OS window, and at 300px in a side panel
 * without a single media query.
 *
 * It holds no state of its own beyond memoized derivations, so the window shell
 * above it owns filters, undo and the agent conversation. Keeping this dumb is
 * what makes it reusable as a substrate other apps can call.
 */

export interface DiscoSurfaceProps {
  spec: DashboardSpec;
  rect: Rect;
  /** Client mode: rows, derived in the browser so filters recompute live. */
  base?: Record<string, Row[]>;
  /** Server mode: frames already computed; rows never shipped. */
  staticFrames?: Record<string, Row[]>;
  /** Active filter predicates, applied at the base before any derivation. */
  filters?: Array<[field: string, value: string]>;
  showReasons?: boolean;
  /** Narrow window: tighten padding, since 16px each side is 7% of a 468px window. */
  compact?: boolean;
  className?: string;
}

/**
 * Resize events arrive far faster than a layout needs to change. Quantising the
 * rect to 8px turns a drag across 900 pixels into ~110 solves instead of 900,
 * and no one can see the difference.
 */
const SOLVE_QUANTUM = 8;
const snap = (v: number) => Math.round(v / SOLVE_QUANTUM) * SOLVE_QUANTUM;

/**
 * Width below which a shell's chrome collapses.
 *
 * 560 is where four controls stop fitting on one line. Wrapping to a second row
 * costs 38px, which at the window floor is 15% of everything the dashboard has.
 * Declared here, beside the surface both shells wrap, so a window cannot be
 * compact for one of them and not the other.
 */
export const CHROME_COMPACT_W = 560;

export function DiscoSurface({
  spec,
  rect,
  base,
  staticFrames,
  filters = [],
  showReasons = false,
  compact = false,
  className,
}: DiscoSurfaceProps) {
  const pad = compact ? 8 : 16;
  const filterKey = React.useMemo(
    () => JSON.stringify([...filters].sort((a, b) => a[0].localeCompare(b[0]))),
    [filters],
  );

  const { frames, error } = React.useMemo<{ frames: Map<string, Frame>; error?: string }>(() => {
    if (staticFrames) {
      return {
        frames: new Map(
          Object.entries(staticFrames).map(([id, rows]) => [id, { id, rows, fields: Object.keys(rows[0] ?? {}) }]),
        ),
      };
    }
    if (!base) return { frames: new Map() };

    const active = JSON.parse(filterKey) as Array<[string, string]>;
    const filtered: Record<string, Row[]> = {};
    for (const [id, rows] of Object.entries(base)) {
      filtered[id] = active.length === 0 ? rows : rows.filter((r) => active.every(([f, v]) => String(r[f] ?? "") === v));
    }

    try {
      return { frames: runPipeline(filtered, spec.derivations) };
    } catch (e) {
      // Never fall back to the unfiltered pipeline: rendering unfiltered numbers
      // beneath an active filter is a confident wrong answer, which is worse
      // than a visible failure.
      return { frames: new Map(), error: (e as Error).message };
    }
  }, [base, staticFrames, spec.derivations, filterKey]);

  const hints = React.useMemo(() => layoutHints(spec.blocks, frames), [spec.blocks, frames]);

  // Hysteresis needs the previous layout, but feeding state back into a memo
  // would loop. A ref carries it forward without participating in the render.
  const previous = React.useRef<Layout | undefined>(undefined);

  const layout = React.useMemo(() => {
    const solved = solveLayout(
      spec.blocks,
      { w: snap(rect.w), h: snap(rect.h) },
      hints,
      { previous: previous.current, padding: pad, gutter: compact ? 8 : 12 },
    );
    previous.current = solved;
    return solved;
  }, [spec.blocks, rect.w, rect.h, hints, pad, compact]);

  /**
   * Axis tick formatting needs the bucket width its frame was built at.
   *
   * The bucket survives every op that does not re-key the rows, and those
   * chains run longer than one step — `timeBucket → derive → downsample` is
   * ordinary. Stopping at the first step drops back to the "day" default, and
   * an hourly window then prints the same date label fourteen times. Run to a
   * fixpoint rather than in list order, since derivations are not required to
   * be listed in dependency order.
   */
  const granularity = React.useMemo(() => {
    const map: Record<string, string> = {};
    const carries = new Set(["derive", "downsample", "filter", "sort"]);
    for (const d of spec.derivations) if (d.op === "timeBucket") map[d.id] = d.unit;

    for (let changed = true; changed; ) {
      changed = false;
      for (const d of spec.derivations) {
        if (map[d.id] === undefined && carries.has(d.op) && map[d.from] !== undefined) {
          map[d.id] = map[d.from];
          changed = true;
        }
      }
    }
    return map;
  }, [spec.derivations]);

  const byId = React.useMemo(() => new Map(spec.blocks.map((b) => [b.id, b])), [spec.blocks]);

  if (error) {
    return (
      <div role="alert" className="m-4 rounded-lg border border-[var(--disco-negative)]/40 bg-[var(--disco-negative)]/5 p-4">
        <p className="text-sm font-medium text-[var(--disco-negative)]">
          The derivation pipeline failed, so no figures are shown.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Showing nothing is deliberate — unfiltered numbers under an active filter would be worse than none.
        </p>
        <pre className="mt-2 overflow-x-auto text-[11px] text-muted-foreground">{error}</pre>
      </div>
    );
  }

  return (
    <div className={className} style={{ padding: pad }}>
      <div style={{ position: "relative", height: layout.contentHeight }}>
        {layout.blocks.map((placement) => {
          const block = byId.get(placement.blockId);
          if (!block) return null;
          return (
            <div
              key={placement.blockId}
              style={{
                position: "absolute",
                left: placement.x,
                top: placement.y,
                width: placement.w,
                height: placement.h,
              }}
            >
              <DiscoBlock
                block={block}
                placement={placement}
                frames={frames}
                granularity={granularity[(block as { from?: string }).from ?? ""] ?? "day"}
                showReason={showReasons}
              />
            </div>
          );
        })}
      </div>

      {/* Hidden blocks are stated, not vanished — otherwise a narrow window
          silently becomes a different dashboard than the one composed. */}
      {layout.hidden.length > 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            {layout.hidden.length} block{layout.hidden.length === 1 ? "" : "s"} hidden at this size
          </p>
          <ul className="mt-1 space-y-0.5">
            {layout.hidden.map((h) => {
              const b = byId.get(h.blockId);
              return (
                <li key={h.blockId} className="text-[11px] text-muted-foreground/80">
                  {b?.title ?? h.blockId} — {h.reason}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Track an element's own width and height.
 *
 * A dashboard inside a window has no business asking the viewport how much room
 * it has: the window is what the user resizes, and a 300px-wide window on a 4K
 * monitor is still 300px wide. Measuring the element makes responsiveness a
 * property of the container, which is the only thing that is actually true.
 */
export function useElementRect(ref: React.RefObject<HTMLElement | null>): Rect | null {
  const [rect, setRect] = React.useState<Rect | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const box = el.getBoundingClientRect();
    setRect({ w: box.width, h: box.height });

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const size = entry.borderBoxSize?.[0];
        setRect({
          // borderBoxSize avoids the forced reflow a getBoundingClientRect per
          // frame would cause while a window is being dragged.
          w: size?.inlineSize ?? entry.contentRect.width,
          h: size?.blockSize ?? entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return rect;
}
