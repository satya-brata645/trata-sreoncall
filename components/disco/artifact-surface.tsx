"use client";

import * as React from "react";
import { SlidersHorizontal, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rebind, type BoundRun } from "@/lib/artifacts/rebind";
import { useLatestRun } from "@/lib/artifacts/useLatestRun";
import { cn } from "@/lib/utils";
import { rangeLabel, type ControlState, type ResolvedControl } from "@disco/core/controls";
import { n } from "@disco/core/format";
import { resolve } from "@disco/core/resolve";
import type { DashboardSpec, RelativeRange } from "@disco/core/spec";

import { prettify } from "./blocks";
import { CHROME_COMPACT_W, DiscoSurface, useElementRect } from "./surface";

/**
 * A pinned spec, bound to whatever the producer dropped last.
 *
 * The shell for artifact-backed dashboards, and the counterpart to
 * `DiscoRenderer`: that one owns ad-hoc filters over a materialized output,
 * this one owns the spec's own controls and the run stream. Both hand the same
 * `DiscoSurface` a rect and get back a solved layout.
 *
 * Three things make it correct rather than merely live:
 *
 *   1. **The spec carries over.** A new run is rebound, never recomposed —
 *      otherwise every reader edit would evaporate every few minutes, and the
 *      dashboard would be a different one each time you looked away.
 *   2. **`now` comes from the run, never the clock.** A `Date.now()` in render
 *      resolves a different time window on the server than in the browser and
 *      React reports it as a hydration mismatch on every timestamp on screen.
 *   3. **Nothing on screen is replaced until its replacement has parsed.** The
 *      swap happens in an effect, after the new document has been fetched and
 *      re-profiled, so a producer mid-write costs a stale badge and not a blank
 *      dashboard.
 */

export interface ArtifactSurfaceProps {
  spec: DashboardSpec;
  /**
   * The run the server bound. The document itself is deliberately not shipped:
   * the client already has the profile and rows derived from it, and sending
   * both would double the payload to say the same thing twice.
   */
  initial: Omit<BoundRun, "document">;
  /** Fill the viewport (standalone page) or the parent (embedded in a window). */
  fill?: "screen" | "parent";
}

/** Sentinel for the "no filter" option; never stored as a control value. */
const ALL = "__all__";

/**
 * "last_24h" becomes "24h", "mtd" becomes "MTD".
 *
 * Derived from the preset id rather than looked up, so a segmented control
 * cannot carry a list that drifts from the schema's. The long form from
 * `rangeLabel` goes on the tooltip, where there is room for it.
 */
const shortRange = (r: RelativeRange) => (r.startsWith("last_") ? r.slice(5) : r.toUpperCase());

const controlLabel = (c: ResolvedControl["control"]) => c.label ?? prettify(c.field);

export function ArtifactSurface({ spec, initial, fill = "screen" }: ArtifactSurfaceProps) {
  const [run, setRun] = React.useState(initial);
  const [state, setState] = React.useState<ControlState>({});
  const [controlsOpen, setControlsOpen] = React.useState(false);
  const [repairsOpen, setRepairsOpen] = React.useState(false);
  const [showReasons, setShowReasons] = React.useState(false);

  const live = useLatestRun();

  // Swapping in an effect rather than during render is what keeps the previous
  // run on screen while the new one is being profiled. Re-profiling a document
  // the page already rendered would also be pure waste, hence the id guard.
  React.useEffect(() => {
    if (!live.run || live.runId === run.runId) return;
    const { profile, base, runId, asOf } = rebind(spec, live.run);
    setRun({ profile, base, runId, asOf });
  }, [live.run, live.runId, run.runId, spec]);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const rootRect = useElementRect(rootRef);
  const bodyRect = useElementRect(bodyRef);

  const compact = (rootRect?.w ?? 1200) < CHROME_COMPACT_W;

  const resolved = React.useMemo(
    () => resolve(spec, run.profile, run.base, { now: Date.parse(run.asOf), state }),
    [spec, run, state],
  );

  // `resolve` has already executed the pipeline; handing the surface those
  // frames stops it running the identical derivations a second time on every
  // keystroke of a resize.
  const frames = React.useMemo(
    () => Object.fromEntries([...resolved.frames].map(([id, f]) => [id, f.rows])),
    [resolved],
  );

  const rows = React.useMemo(
    () => run.profile.tables.reduce((a, t) => a + t.rowCount, 0),
    [run.profile],
  );

  const asOfLabel = React.useMemo(
    () =>
      new Date(run.asOf).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }),
    [run.asOf],
  );

  const set = React.useCallback(
    (id: string, value: string | string[]) => setState((s) => ({ ...s, [id]: value })),
    [],
  );

  const errors = resolved.unresolved.filter((i) => i.level === "error");

  const controls = resolved.controls.map((r) =>
    r.control.kind === "timeRange" ? (
      <div
        key={r.control.id}
        role="group"
        aria-label={controlLabel(r.control)}
        className="flex items-center gap-0.5 rounded-lg border border-border/70 p-0.5"
      >
        {r.control.presets.map((preset) => (
          <Button
            key={preset}
            variant={preset === r.value ? "secondary" : "ghost"}
            size="xs"
            className="px-2 text-[11px]"
            aria-pressed={preset === r.value}
            title={rangeLabel(preset)}
            onClick={() => set(r.control.id, preset)}
          >
            {shortRange(preset)}
          </Button>
        ))}
      </div>
    ) : r.control.mode === "multi" ? (
      <div key={r.control.id} role="group" aria-label={controlLabel(r.control)} className="flex flex-wrap items-center gap-0.5">
        {(r.options ?? []).map((option) => {
          const on = (r.value as string[]).includes(option);
          return (
            <Button
              key={option}
              variant={on ? "secondary" : "ghost"}
              size="xs"
              className="px-2 text-[11px]"
              aria-pressed={on}
              onClick={() =>
                set(
                  r.control.id,
                  on ? (r.value as string[]).filter((v) => v !== option) : [...(r.value as string[]), option],
                )
              }
            >
              {option}
            </Button>
          );
        })}
      </div>
    ) : (
      <Select
        key={r.control.id}
        /* "no filter" is the absence of a value, not a sentinel value — so the
           placeholder shows a readable label instead of a token. */
        value={(r.value as string[])[0] || undefined}
        onValueChange={(v) => set(r.control.id, v && v !== ALL ? [v] : [])}
      >
        <SelectTrigger size="sm" className="h-7 w-auto min-w-[130px] text-xs" aria-label={controlLabel(r.control)}>
          <SelectValue placeholder={`All ${controlLabel(r.control)}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {controlLabel(r.control)}</SelectItem>
          {(r.options ?? []).map((option) => (
            <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
  );

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col overflow-hidden bg-background", fill === "screen" ? "h-dvh" : "h-full")}
    >
      <header className="shrink-0 border-b border-border/70">
        <div className={cn("flex items-center gap-2", compact ? "px-3 py-2" : "flex-wrap gap-3 px-4 py-3")}>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium tracking-tight">{spec.title}</h1>
            {!compact && <p className="truncate text-xs text-muted-foreground">{spec.subtitle}</p>}
          </div>

          {!compact && (
            <Badge variant="outline" className="gap-1.5 font-normal" title={live.error ?? `run ${run.runId}`}>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  // Stale is a colour change, not an empty screen: the numbers
                  // beside it are still real, they are just not the newest.
                  live.error ? "bg-[var(--disco-negative)]" : "bg-[var(--disco-positive)]",
                  !live.error && live.isStreaming && "animate-pulse",
                )}
                aria-hidden
              />
              {n(rows)} rows · {asOfLabel} UTC
            </Badge>
          )}

          {resolved.repairs.length > 0 && (
            <Button
              variant={repairsOpen ? "secondary" : "ghost"}
              size="sm"
              className={cn("shrink-0", compact && "h-7 px-2 text-xs")}
              onClick={() => setRepairsOpen((v) => !v)}
              aria-expanded={repairsOpen}
              title={resolved.repairs.map((r) => `${r.note} (${r.because})`).join("\n")}
            >
              <Wrench className="size-3" aria-hidden />
              {resolved.repairs.length}
              {!compact && " adapted"}
            </Button>
          )}

          {compact && controls.length > 0 && (
            <Button
              variant={resolved.filtered ? "secondary" : "ghost"}
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-xs"
              onClick={() => setControlsOpen((v) => !v)}
              aria-expanded={controlsOpen}
            >
              <SlidersHorizontal className="size-3" aria-hidden />
            </Button>
          )}

          <Button
            variant={showReasons ? "secondary" : "ghost"}
            size="sm"
            className={cn("shrink-0", compact && "h-7 px-2 text-xs")}
            onClick={() => setShowReasons((v) => !v)}
            title="Why this chart"
          >
            {compact ? "Why" : "Why this chart"}
          </Button>
        </div>

        {/* Wide: the controls are always reachable. Narrow: folded behind one
            button, because two chrome rows at the window floor cost a quarter
            of everything the dashboard has. */}
        {controls.length > 0 && (!compact || controlsOpen) && (
          <div className={cn("flex flex-wrap items-center gap-2 border-t border-border/50 py-2", compact ? "px-3" : "px-4")}>
            {controls}
          </div>
        )}
      </header>

      {/* A repair is an event, not a setting: what changed, and the measured
          fact that forced it. Without the second half it reads as a bug. */}
      {repairsOpen && resolved.repairs.length > 0 && (
        <div className="shrink-0 border-b border-border/70 px-4 py-2">
          <ul className="space-y-1">
            {resolved.repairs.map((r, i) => (
              <li key={`${r.ruleId}-${r.where}-${i}`} className="text-[11px] leading-relaxed">
                <span className="font-medium">{r.note}</span>{" "}
                <span className="text-muted-foreground">{r.because} · {r.where} · {r.ruleId}</span>
                {r.lossy && (
                  <Badge variant="outline" className="ml-1.5 border-[var(--disco-accent)]/40 text-[10px] font-normal">
                    hides data
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Unresolved errors are never folded away. A repair is the system coping;
          this is the system out of options, and the blocks below it are wrong. */}
      {errors.length > 0 && (
        <div role="alert" className="shrink-0 border-b border-[var(--disco-negative)]/40 bg-[var(--disco-negative)]/5 px-4 py-2">
          <p className="text-[11px] font-medium text-[var(--disco-negative)]">
            {errors.length} problem{errors.length === 1 ? "" : "s"} no repair could fix
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {errors.slice(0, 3).map((e, i) => (
              <li key={`${e.where}-${i}`} className="text-[11px] text-muted-foreground">
                {e.where} — {e.message}
                {e.fix && ` · ${e.fix}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The measured element. Its rect is what the solver plans against — the
          viewport is deliberately never consulted. */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {bodyRect && (
          <DiscoSurface
            spec={resolved.spec}
            rect={bodyRect}
            staticFrames={frames}
            showReasons={showReasons}
            compact={compact}
          />
        )}
      </div>

      {!compact && spec.notes.length > 0 && (
        <footer className="shrink-0 border-t border-border/70 px-4 py-2">
          <ul className="space-y-0.5">
            {spec.notes.slice(0, 2).map((note, i) => (
              <li key={i} className="truncate text-[11px] text-muted-foreground">— {note}</li>
            ))}
          </ul>
        </footer>
      )}
    </div>
  );
}
