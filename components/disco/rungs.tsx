"use client";

import * as React from "react";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer } from "recharts";
import { AlertTriangle, Bell, CircleCheck, Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatValue, n, type Format } from "@disco/core/format";
import type { Row } from "@disco/core/algebra";

/**
 * Degraded rungs — what a block becomes when the window will not give it the
 * space its full form needs.
 *
 * The design rule these all follow: a rung drops a *channel*, never a *fact*.
 * A sparkline loses its axes but keeps its shape and labels its endpoints; a
 * share bar loses the angle encoding but keeps every share exact; a top-5 list
 * loses the tail but says how much it dropped. Nothing here silently shows less
 * data than it appears to — that would make a small window a source of wrong
 * conclusions rather than merely a smaller view.
 */

const SERIES_1 = "var(--color-role-series-1)";

/* ------------------------------------------------------------------ *
 * Status — shared by the full forms and their rungs
 * ------------------------------------------------------------------ *
 *
 * These live in this file, not in the catalog, because the dependency has to
 * run one way: `blocks.tsx` and `blocks-extra.tsx` both import from here and
 * nothing here imports back. A severity that classified differently at full
 * size than at a degraded one would be worse than either.
 */

/**
 * The amber.
 *
 * Deliberately not a `--color-role-series-*` value and deliberately not added
 * to that ramp: the ramp is a validated set in which "critical" must never be
 * confusable with "series 2", so a status hue stays outside it. It is a local
 * constant rather than a token only because the OS token layer has no
 * `--disco-warning` yet; it is the same amber the hand-built panels used.
 */
export const WARN_HUE = "#e2a03f";
export const CRIT_HUE = "var(--disco-negative)";

export type Severity = "critical" | "warning" | "notice" | "ok";

/**
 * Severity vocabularies are the producer's, not ours — one dataset says
 * `SEV1`, the next says `breach`, the next says `p1`. Matching a family of
 * spellings keeps the block usable without forcing every producer to rename a
 * column, and the word actually shown to the reader is always the producer's
 * own (see `CalloutBlock`), so nothing is silently relabelled.
 */
const SEVERITY_PATTERNS: Array<[Severity, RegExp]> = [
  ["critical", /^(sev-?[01]|p[01]|crit(ical)?|breach(ing)?|down|outage|fail(ed|ing)?|error|fatal|red)$/],
  ["warning", /^(sev-?2|p2|warn(ing)?|at.?risk|risk|degraded|amber|orange|high)$/],
  ["notice", /^(sev-?3|p3|stale|overdue|ageing|aging|pending|notice|watch|medium)$/],
  ["ok", /^(sev-?[45]|p[45]|noise|info(rmational)?|ok|healthy|resolved|nominal|green|low)$/],
];

export function severityOf(raw: unknown): Severity {
  const key = String(raw ?? "").trim().toLowerCase();
  for (const [level, re] of SEVERITY_PATTERNS) if (re.test(key)) return level;
  // An unrecognised word is never "ok". A vocabulary this block has not seen
  // before is a reason to look at the row, not a reason to relax about it.
  return "notice";
}

/** Highest severity first — this is the order the callout is ranked by. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warning: 2, notice: 1, ok: 0 };

export function severityStyle(s: Severity): {
  tint: string;
  ring: string;
  Icon: typeof AlertTriangle;
} {
  switch (s) {
    case "critical":
      return { tint: CRIT_HUE, ring: "border-[var(--disco-negative)]/45", Icon: AlertTriangle };
    case "warning":
      return { tint: WARN_HUE, ring: "border-[#e2a03f]/45", Icon: Bell };
    case "notice":
      // Neutral rather than a series hue. Borrowing series-6 for "stale" would
      // make the same violet mean an identity in one card and a status in the
      // next, which is exactly the confusion the reserved-hue rule prevents.
      return { tint: "var(--muted-foreground)", ring: "border-border/70", Icon: Clock };
    default:
      return { tint: "var(--disco-positive)", ring: "border-border/70", Icon: CircleCheck };
  }
}

/**
 * Threshold colour for a magnitude.
 *
 * `inverse` says a LOW value is the bad one — a remaining error budget breaches
 * by falling, an error rate by rising — so one function serves both and the
 * caller states which way its metric points instead of each call site
 * re-deriving it. Returns null when the value is within tolerance, so the
 * caller keeps its own identity colour rather than being forced to a status
 * hue for being fine.
 */
export function statusTint(
  value: number,
  warnAt?: number,
  critAt?: number,
  inverse = false,
): string | null {
  if (!Number.isFinite(value)) return null;
  const breached = (t: number) => (inverse ? value <= t : value >= t);
  if (critAt !== undefined && breached(critAt)) return CRIT_HUE;
  if (warnAt !== undefined && breached(warnAt)) return WARN_HUE;
  return null;
}

/** The spelled-out word beside the colour. Colour alone is never the message. */
export function statusWord(
  value: number,
  warnAt?: number,
  critAt?: number,
  inverse = false,
): string | null {
  const tint = statusTint(value, warnAt, critAt, inverse);
  return tint === CRIT_HUE ? "critical" : tint === WARN_HUE ? "at risk" : null;
}

/* ------------------------------------------------------------------ *
 * Funnel arithmetic, shared by all three funnel forms
 * ------------------------------------------------------------------ */

/**
 * Share of the *previous* stage, not of the first.
 *
 * A funnel that reports every stage against the top makes a 5% stage look
 * uniformly terrible whether it lost 95% of its own input or 5% of it. The
 * stage-to-stage ratio is the only one that says where the work actually went.
 */
export function shareOfPrevious(rows: Row[], value: string): Array<number | null> {
  return rows.map((r, i) => {
    if (i === 0) return null;
    const prev = Number(rows[i - 1][value]) || 0;
    return prev === 0 ? null : ((Number(r[value]) || 0) / prev) * 100;
  });
}

/**
 * Width of a funnel bar as a percentage of the first stage.
 *
 * Log by default because a real funnel spans orders of magnitude — millions of
 * signals down to tens of postmortems. On a linear scale every stage after the
 * first is a sub-pixel sliver, and the resulting silhouette claims "everything
 * is lost immediately", which is a statement about the scale rather than about
 * the data. The 6% floor keeps the smallest stage visible as a mark rather than
 * as nothing at all.
 */
export function funnelWidth(count: number, first: number, scale: "log" | "linear"): number {
  const c = Math.max(count, 0);
  const f = Math.max(first, 0);
  if (f <= 0) return 6;
  if (scale === "linear") return Math.max(6, Math.min(100, (c / f) * 100));
  const denominator = Math.log10(f + 1);
  if (denominator <= 0) return 6;
  return Math.max(6, Math.min(100, (Math.log10(c + 1) / denominator) * 100));
}

/** First clause only. A truncated "handled without decla…" reads as a bug. */
export function shortReason(reason: string): string {
  const head = reason.split(/[—:]/)[0].trim();
  const words = head.split(" ");
  return words.length <= 3 ? head : `${words.slice(0, 3).join(" ")}…`;
}

/* ------------------------------------------------------------------ *
 * timeseries.sparkline
 * ------------------------------------------------------------------ */

export function SparklineTimeseries({
  rows,
  x,
  y,
  format,
  height,
}: {
  rows: Row[];
  x: string;
  y: string;
  format: Format;
  height: number;
}) {
  const values = rows.map((r) => Number(r[y])).filter((v) => Number.isFinite(v));
  const first = values[0];
  const last = values[values.length - 1];
  const gradientId = React.useId();

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
        {/* Endpoints carry the scale that the missing axes used to. */}
        <span>{formatValue(first, format)}</span>
        <span className="font-medium text-foreground">{formatValue(last, format)}</span>
      </div>
      <div style={{ height: Math.max(height - 34, 24) }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES_1} stopOpacity={0.3} />
                <stop offset="100%" stopColor={SERIES_1} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              dataKey={y}
              type="monotone"
              stroke={SERIES_1}
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <span className="sr-only">Sparkline of {y} over {x}; axes omitted for space.</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * pie.share_bar
 * ------------------------------------------------------------------ */

export function ShareBar({
  rows,
  category,
  value,
  format,
}: {
  rows: Row[];
  category: string;
  value: string;
  format: Format;
}) {
  const sorted = [...rows].sort((a, b) => Number(b[value] ?? 0) - Number(a[value] ?? 0));
  const total = sorted.reduce((a, r) => a + (Number(r[value]) || 0), 0);

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      {/* A 2px surface gap keeps adjacent segments from bleeding together. */}
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-sm">
        {sorted.map((r, i) => {
          const pct = total ? ((Number(r[value]) || 0) / total) * 100 : 0;
          return (
            <div
              key={i}
              className="h-full first:rounded-l-sm last:rounded-r-sm"
              style={{ width: `${pct}%`, background: `var(--color-role-series-${i + 1})` }}
              title={`${r[category]}: ${formatValue(r[value], format)} (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {sorted.map((r, i) => (
          <li key={i} className="flex items-center gap-1.5 tabular-nums">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: `var(--color-role-series-${i + 1})` }}
              aria-hidden
            />
            <span className="text-muted-foreground">{String(r[category])}</span>
            <span>{total ? (((Number(r[value]) || 0) / total) * 100).toFixed(0) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * bar.list — no axis at all; share is drawn as a background fill
 * ------------------------------------------------------------------ */

export function BarList({
  rows,
  category,
  value,
  format,
  maxItems,
}: {
  rows: Row[];
  category: string;
  value: string;
  format: Format;
  maxItems?: number;
}) {
  const sorted = [...rows].sort((a, b) => Number(b[value] ?? 0) - Number(a[value] ?? 0));
  const shown = maxItems ? sorted.slice(0, maxItems) : sorted;
  const max = Math.max(...shown.map((r) => Number(r[value]) || 0), 1);
  const dropped = sorted.length - shown.length;

  return (
    <div className="flex h-full flex-col gap-0.5 overflow-hidden">
      {shown.map((r, i) => (
        <div key={i} className="relative flex items-center justify-between rounded-[3px] px-2 py-1 text-xs">
          <div
            className="absolute inset-y-0 left-0 rounded-[3px]"
            style={{ width: `${((Number(r[value]) || 0) / max) * 100}%`, background: SERIES_1, opacity: 0.15 }}
            aria-hidden
          />
          <span className="relative z-10 truncate text-muted-foreground">{String(r[category])}</span>
          <span className="relative z-10 shrink-0 tabular-nums">{formatValue(r[value], format)}</span>
        </div>
      ))}
      {dropped > 0 && (
        // Never hide the tail silently — a truncated list that looks complete
        // is how someone reads a partial total as a full one.
        <p className="mt-auto pt-1 text-[10px] text-muted-foreground">
          + {dropped} more not shown — widen to see {dropped === 1 ? "it" : "them"}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * histogram.sparkbars
 * ------------------------------------------------------------------ */

export function SparkBars({
  rows,
  y,
  height,
}: {
  rows: Row[];
  y: string;
  height: number;
}) {
  const counts = rows.map((r) => Number(r[y]) || 0);
  const total = counts.reduce((a, b) => a + b, 0);

  return (
    <div className="flex h-full flex-col justify-center">
      <div style={{ height: Math.max(height - 22, 20) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Bar dataKey={y} fill={SERIES_1} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {rows.length} bins · {n(total)} rows
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * table.top5 / heatmap.rowstrip
 * ------------------------------------------------------------------ */

export function Top5Table({
  rows,
  columns,
  maxItems = 5,
}: {
  rows: Row[];
  columns: Array<{ field: string; label: string; format?: Format; align: "left" | "right" }>;
  maxItems?: number;
}) {
  // Two columns is what stays legible at this size: the first dimension to name
  // the row, and the first measure to rank it.
  const shown = columns.slice(0, 2);
  const visible = rows.slice(0, maxItems);

  return (
    <div className="flex h-full flex-col gap-0.5 overflow-hidden">
      {visible.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-2 border-b border-border/30 py-1 text-xs last:border-0">
          {shown.map((c) => (
            <span
              key={c.field}
              className={cn("truncate", c.align === "right" ? "shrink-0 tabular-nums" : "text-muted-foreground")}
            >
              {c.format ? formatValue(r[c.field], c.format) : String(r[c.field] ?? "—")}
            </span>
          ))}
        </div>
      ))}
      <p className="mt-auto pt-1 text-[10px] text-muted-foreground">
        {visible.length} of {n(rows.length)} rows · {shown.length} of {columns.length} columns
      </p>
    </div>
  );
}

export function RowStripHeatmap({
  rows,
  y,
  value,
  format,
  maxItems = 6,
}: {
  rows: Row[];
  y: string;
  value: string;
  format: Format;
  maxItems?: number;
}) {
  const byRow = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[y] ?? "");
    byRow.set(k, (byRow.get(k) ?? 0) + (Number(r[value]) || 0));
  }
  const sorted = [...byRow.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxItems);
  const max = Math.max(...sorted.map(([, v]) => v), 1);

  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden">
      {sorted.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 truncate text-muted-foreground">{k}</span>
          <div
            className="h-3 flex-1 rounded-[2px]"
            /* Sequential magnitude: one hue, light to dark. */
            style={{ background: `color-mix(in oklab, var(--color-role-sequential-hue) ${(v / max) * 100}%, var(--card))` }}
          />
          <span className="shrink-0 tabular-nums">{formatValue(v, format)}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * funnel.compact — attrition lines and stage durations drop
 * ------------------------------------------------------------------ */

export function FunnelCompact({
  rows,
  stage,
  value,
  attrition,
  format,
}: {
  rows: Row[];
  stage: string;
  value: string;
  attrition?: string;
  format: Format;
}) {
  const shares = shareOfPrevious(rows, value);
  const lost = attrition ? rows.reduce((a, r) => a + (Number(r[attrition]) || 0), 0) : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ol className="grid min-h-0 flex-1 items-center gap-1" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((r, i) => (
          <li key={i} className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-1.5 py-1">
            <p className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">{String(r[stage] ?? "—")}</p>
            <p className="truncate text-sm font-semibold tabular-nums">{formatValue(r[value], format)}</p>
            <p className="truncate text-[9px] tabular-nums text-muted-foreground">
              {shares[i] === null ? "start" : `${shares[i]!.toFixed(shares[i]! < 10 ? 1 : 0)}% of prev`}
            </p>
          </li>
        ))}
      </ol>

      {/* The per-stage attrition channel is gone, so the total is stated instead
          — a funnel that quietly stops mentioning what it lost is the one thing
          this block exists to prevent. */}
      <p className="shrink-0 pt-1 text-[10px] text-muted-foreground">
        {attrition && lost > 0
          ? `−${formatValue(lost, format)} lost across ${rows.length} stages · per-stage attrition and durations hidden — widen to restore`
          : `Attrition and stage durations hidden — widen to restore`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * funnel.list — stacked rows; width was the scarce axis, height is not
 * ------------------------------------------------------------------ */

export function FunnelList({
  rows,
  stage,
  value,
  attrition,
  reason,
  format,
  maxItems,
}: {
  rows: Row[];
  stage: string;
  value: string;
  attrition?: string;
  reason?: string;
  format: Format;
  maxItems?: number;
}) {
  const shares = shareOfPrevious(rows, value);
  const shown = maxItems ? rows.slice(0, maxItems) : rows;
  const dropped = rows.length - shown.length;
  const first = Number(rows[0]?.[value]) || 0;

  return (
    <div className="flex h-full flex-col gap-0.5 overflow-hidden">
      {shown.map((r, i) => {
        const lost = attrition ? Number(r[attrition]) || 0 : 0;
        return (
          <div key={i} className="relative flex items-center gap-2 rounded-[3px] px-2 py-1 text-xs">
            {/* Same log geometry as the full form: the rung loses the row of
                cards, not the scale the bars were drawn on. */}
            <div
              className="absolute inset-y-0 left-0 rounded-[3px]"
              style={{ width: `${funnelWidth(Number(r[value]) || 0, first, "log")}%`, background: SERIES_1, opacity: 0.15 }}
              aria-hidden
            />
            <span className="relative z-10 min-w-0 flex-1 truncate text-muted-foreground">{String(r[stage] ?? "—")}</span>
            {lost > 0 && (
              <span
                className="relative z-10 shrink-0 text-[10px] tabular-nums text-[var(--disco-negative)]/80"
                title={reason ? `${formatValue(lost, format)} left here — ${String(r[reason] ?? "")}` : undefined}
              >
                −{formatValue(lost, format)}
              </span>
            )}
            <span className="relative z-10 w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/70">
              {shares[i] === null ? "start" : `${shares[i]!.toFixed(0)}%`}
            </span>
            <span className="relative z-10 shrink-0 tabular-nums">{formatValue(r[value], format)}</span>
          </div>
        );
      })}
      {dropped > 0 && (
        <p className="mt-auto pt-1 text-[10px] text-muted-foreground">
          + {dropped} later stage{dropped === 1 ? "" : "s"} not shown — widen to see the rest of the funnel
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * radar.bars
 * ------------------------------------------------------------------ */

/**
 * A radar's wide rows reshaped into one point per axis.
 *
 * Both the polygon and its bar rung need exactly this, and an entity named in
 * the spec but absent from the frame must not quietly become a zero — a shape
 * pinned at the origin reads as "measured, and terrible" rather than "not
 * present". So missing entities are dropped and reported instead.
 */
export function radarPoints(
  rows: Row[],
  entity: string,
  axes: string[],
  series: string[],
): {
  points: Array<Record<string, string | number>>;
  entities: string[];
  missing: string[];
} {
  const byEntity = new Map(rows.map((r) => [String(r[entity] ?? ""), r]));
  const entities = series.filter((s) => byEntity.has(s));
  const missing = series.filter((s) => !byEntity.has(s));

  const points = axes.map((axis) => {
    const point: Record<string, string | number> = { axis };
    for (const s of entities) point[s] = Number(byEntity.get(s)?.[axis]) || 0;
    return point;
  });

  return { points, entities, missing };
}

export function RadarBars({
  points,
  entities,
  max,
}: {
  points: Array<Record<string, string | number>>;
  entities: string[];
  max: number;
}) {
  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden">
      {entities.length > 1 && (
        <ul className="flex shrink-0 flex-wrap gap-x-3 text-[10px]">
          {entities.map((e, i) => (
            <li key={e} className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: `var(--color-role-series-${i + 1})` }} aria-hidden />
              <span className="truncate text-muted-foreground">{e}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Grouped bars, one group per axis. Drawn as DOM rather than as a
          Recharts category chart because at this width a category axis spends a
          third of the space on tick chrome, and scarce width is the entire
          reason the polygon was given up. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1">
        {points.map((p) => (
          <div key={String(p.axis)} className="flex items-center gap-2">
            <span className="w-[38%] max-w-[120px] shrink-0 truncate text-[10px] text-muted-foreground">{String(p.axis)}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              {entities.map((e, i) => (
                <div key={e} className="h-[3px] w-full rounded-full bg-white/5" title={`${e} · ${String(p.axis)}: ${Number(p[e])} of ${max}`}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(0, Math.min(100, (Number(p[e]) / (max || 1)) * 100))}%`, background: `var(--color-role-series-${i + 1})` }}
                  />
                </div>
              ))}
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
              {entities.map((e) => Math.round(Number(p[e]))).join(" / ")}
            </span>
          </div>
        ))}
      </div>

      <p className="shrink-0 text-[10px] text-muted-foreground">
        Silhouette dropped — every value kept, scaled 0–{max}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * radial.bar
 * ------------------------------------------------------------------ */

export function RadialBars({
  rows,
  category,
  value,
  max,
  warnAt,
  critAt,
  format,
  maxItems,
}: {
  rows: Row[];
  category: string;
  value: string;
  max: number;
  warnAt?: number;
  critAt?: number;
  format: Format;
  maxItems?: number;
}) {
  const shown = maxItems ? rows.slice(0, maxItems) : rows;
  const dropped = rows.length - shown.length;

  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden">
      {shown.map((r, i) => {
        const v = Number(r[value]) || 0;
        // A gauge breaches by falling: `warnAt`/`critAt` are floors, not ceilings.
        const tint = statusTint(v, warnAt, critAt, true);
        const word = statusWord(v, warnAt, critAt, true);
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-[34%] max-w-[130px] shrink-0 truncate text-[11px] text-muted-foreground">{String(r[category] ?? "—")}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, (v / (max || 1)) * 100))}%`,
                  background: tint ?? `var(--color-role-series-${(i % 6) + 1})`,
                }}
              />
            </div>
            {word && <span className="shrink-0 text-[9px] uppercase tracking-wider" style={{ color: tint ?? undefined }}>{word}</span>}
            <span className="shrink-0 tabular-nums">{formatValue(v, format)}</span>
          </div>
        );
      })}

      <p className="mt-auto pt-1 text-[10px] text-muted-foreground">
        Arcs dropped — each bar is the same magnitude against {max}
        {dropped > 0 ? ` · ${dropped} more not shown` : ""}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * callout.compact / callout.count
 * ------------------------------------------------------------------ */

/** One row of a callout, already read off its frame. */
export interface CalloutItem {
  key: string;
  title: string;
  detail?: string;
  meta?: string;
  /** The producer's own word, shown verbatim. */
  severity: string;
}

/**
 * The empty state, and it is deliberately positive.
 *
 * "No results" on a list of things that are on fire is ambiguous — it reads as
 * a broken query as easily as a quiet night. Saying what is true removes the
 * ambiguity.
 */
export function CalloutEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center gap-2 rounded-lg border border-[var(--disco-positive)]/30 px-3 py-2">
      <CircleCheck className="size-4 shrink-0 text-[var(--disco-positive)]" aria-hidden />
      <p className="min-w-0 truncate text-sm">{text}</p>
    </div>
  );
}

export function CalloutCompact({
  items,
  maxItems,
  emptyText,
}: {
  items: CalloutItem[];
  maxItems?: number;
  emptyText: string;
}) {
  if (items.length === 0) return <CalloutEmpty text={emptyText} />;

  const shown = maxItems ? items.slice(0, maxItems) : items;
  const dropped = items.length - shown.length;

  return (
    <ol className="flex h-full flex-col gap-1 overflow-hidden">
      {shown.map((item) => {
        const style = severityStyle(severityOf(item.severity));
        const Icon = style.Icon;
        return (
          <li key={item.key} className={cn("flex items-center gap-2 rounded-lg border bg-background/40 px-2 py-1", style.ring)}>
            <Icon className="size-3 shrink-0" style={{ color: style.tint }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[12px]">{item.title}</span>
            {/* The word, never the hue on its own. */}
            <span className="shrink-0 text-[9px] uppercase tracking-wider" style={{ color: style.tint }}>
              {item.severity}
            </span>
          </li>
        );
      })}
      <li className="mt-auto pt-1 text-[10px] text-muted-foreground">
        {dropped > 0 ? `${shown.length} of ${n(items.length)} · ` : ""}detail line hidden — widen to restore
      </li>
    </ol>
  );
}

export function CalloutCount({ items, emptyText }: { items: CalloutItem[]; emptyText: string }) {
  if (items.length === 0) return <CalloutEmpty text={emptyText} />;

  const worst = items.reduce<CalloutItem>((a, b) =>
    SEVERITY_RANK[severityOf(b.severity)] > SEVERITY_RANK[severityOf(a.severity)] ? b : a, items[0]);
  const style = severityStyle(severityOf(worst.severity));
  const Icon = style.Icon;

  return (
    <div className="flex h-full flex-col justify-center gap-0.5">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0" style={{ color: style.tint }} aria-hidden />
        <span className="text-sm font-semibold tabular-nums">
          {n(items.length)} need{items.length === 1 ? "s" : ""} attention
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider" style={{ color: style.tint }}>
          {worst.severity}
        </span>
      </div>
      {/* Titles are gone but the count and the worst severity are not: the one
          fact that must survive every size is that something is wrong. */}
      <p className="truncate text-[10px] text-muted-foreground">
        Worst: {worst.title} — widen for the list
      </p>
    </div>
  );
}
