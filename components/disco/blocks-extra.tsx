"use client";

import * as React from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type { Frame } from "@disco/core/algebra";
import { formatValue } from "@disco/core/format";
import type { Affordances } from "@disco/core/contracts";
import type { PlacedBlock } from "@disco/core/layout";
import type { Block } from "@disco/core/spec";

import {
  CalloutCompact,
  CalloutCount,
  CalloutEmpty,
  FunnelCompact,
  FunnelList,
  RadarBars,
  RadialBars,
  funnelWidth,
  radarPoints,
  severityOf,
  severityStyle,
  shareOfPrevious,
  shortReason,
  statusTint,
  statusWord,
  type CalloutItem,
} from "./rungs";

/**
 * The four newest block kinds — funnel, radar, radial, callout — and the card
 * primitives the whole catalog is built from.
 *
 * The primitives live here rather than in `blocks.tsx` for one reason: the
 * dependency has to run one way. `blocks.tsx` imports this file to dispatch to
 * these four components, so if `Shell` lived there this file would have to
 * import back and the two would form a cycle. One `Shell` shared by thirteen
 * kinds is worth more than the filename reading tidily.
 *
 * Everything in here obeys the same inversion as the rest of the catalog:
 * nothing decides its own size. `placement.w`, `placement.h`,
 * `placement.variant` and `placement.affordances` come from the solver and the
 * component renders exactly what it was told it has room for.
 */

/* ------------------------------------------------------------------ *
 * Shared primitives
 * ------------------------------------------------------------------ */

/** Fixed assignment, never cycled — the validator rejects a 7th series upstream. */
export const seriesColor = (i: number) =>
  i < 6 ? `var(--color-role-series-${i + 1})` : "var(--muted-foreground)";

export function buildConfig(keys: string[]): ChartConfig {
  return Object.fromEntries(
    keys.map((k, i) => [k, { label: prettify(k), color: seriesColor(i) }]),
  ) as ChartConfig;
}

/** "amount_usd" reads as noise on an axis; "Amount Usd" reads as a label. */
export function prettify(key: string): string {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const axisStyle = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

export interface BlockProps {
  block: Block;
  placement: PlacedBlock;
  frames: Map<string, Frame>;
  granularity: string;
}

/** Height left for the plot once the header has taken its share. */
export function bodyHeight(h: number, a: Affordances): number {
  const header = a.title ? (a.subtitle ? 46 : 30) : 0;
  return Math.max(h - header - 24, 40);
}

export function Shell({
  block,
  placement,
  children,
}: {
  block: Block;
  placement: PlacedBlock;
  children: React.ReactNode;
}) {
  const a = placement.affordances;
  return (
    <section
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card px-4 py-3"
      aria-label={block.title ?? block.id}
    >
      {a.title && block.title && (
        <header className="mb-2 shrink-0">
          <h3 className="truncate text-sm font-medium tracking-tight">{block.title}</h3>
          {a.subtitle && block.subtitle && (
            <p className="truncate text-xs text-muted-foreground">{block.subtitle}</p>
          )}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function Empty({ reason }: { reason: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
      {reason}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Funnel
 * ------------------------------------------------------------------ */

/**
 * Minutes, formatted as minutes.
 *
 * Not `formatValue(v, "duration")`: that formatter reads its input as
 * milliseconds, so a stage median of 42 minutes would render as "42 ms" — off
 * by four orders of magnitude and entirely plausible-looking.
 */
function minutesLabel(value: unknown): string | null {
  const m = Number(value);
  if (!Number.isFinite(m)) return null;
  if (m < 1) return "<1m";
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  return h < 24 ? `${h.toFixed(h < 10 ? 1 : 0)}h` : `${(h / 24).toFixed(1)}d`;
}

export function FunnelBlock({
  block,
  placement,
  frames,
}: BlockProps & { block: Extract<Block, { kind: "funnel" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  // Table order, never sorted. A funnel's meaning is its sequence; ranking the
  // stages by size would turn a pipeline into a bar chart of unrelated counts.
  const rows = frame.rows;

  if (placement.variant === "funnel.list") {
    return (
      <Shell block={block} placement={placement}>
        <FunnelList
          rows={rows}
          stage={block.stage}
          value={block.value}
          attrition={block.attrition}
          reason={block.reasonField}
          format={block.format}
          maxItems={a.maxItems}
        />
      </Shell>
    );
  }

  if (placement.variant === "funnel.compact") {
    return (
      <Shell block={block} placement={placement}>
        <FunnelCompact rows={rows} stage={block.stage} value={block.value} attrition={block.attrition} format={block.format} />
      </Shell>
    );
  }

  const shares = shareOfPrevious(rows, block.value);
  const first = Number(rows[0]?.[block.value]) || 0;

  return (
    <Shell block={block} placement={placement}>
      {/* One row, always. Wrapping the cards onto a second line would put stage
          five to the left of stage four, and left-to-right IS the encoding —
          a funnel that reads out of order has stopped being a funnel. Narrow
          cards truncate their labels instead; no stage is ever dropped. */}
      <ol
        className="grid h-full min-w-0 items-stretch gap-1.5"
        style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
      >
        {rows.map((r, i) => {
          const count = Number(r[block.value]) || 0;
          const lost = block.attrition ? Number(r[block.attrition]) || 0 : 0;
          const duration = block.duration ? minutesLabel(r[block.duration]) : null;
          const share = shares[i];

          return (
            <li
              key={i}
              className="min-w-0 rounded-xl border border-border/50 bg-background/40 p-2 transition-colors hover:border-[var(--disco-accent)]/40"
              title={block.detail ? String(r[block.detail] ?? "") : undefined}
            >
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {String(r[block.stage] ?? "—")}
              </p>
              <p className="truncate text-lg font-semibold tabular-nums tracking-tight">
                {formatValue(count, block.format)}
              </p>

              {/* Log-scaled by default — see `funnelWidth` for why linear lies
                  about a pipeline that spans orders of magnitude. */}
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${funnelWidth(count, first, block.scale)}%`, background: seriesColor(0), opacity: 0.8 }}
                />
              </div>

              <div className="mt-1.5 flex items-baseline justify-between gap-1">
                <span className="truncate text-[10px] tabular-nums text-muted-foreground">
                  {share === null ? "start" : `${share.toFixed(share < 10 ? 1 : 0)}% of prev`}
                </span>
                {duration && a.valueLabels && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{duration}</span>
                )}
              </div>

              {/* Attrition is drawn as loudly as throughput. A funnel that shows
                  only its survivors is flattering itself, and the stage where
                  work leaks is the one thing a reader came here to find. */}
              {lost > 0 && (
                <p
                  className="mt-1 truncate text-[10px] leading-snug text-[var(--disco-negative)]/75"
                  title={block.reasonField ? `${formatValue(lost, block.format)} left the pipeline here — ${String(r[block.reasonField] ?? "")}` : undefined}
                >
                  −{formatValue(lost, block.format)}
                  {block.reasonField && (
                    <span className="ml-1 text-muted-foreground/60">{shortReason(String(r[block.reasonField] ?? ""))}</span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Radar
 * ------------------------------------------------------------------ */

export function RadarBlock({
  block,
  placement,
  frames,
}: BlockProps & { block: Extract<Block, { kind: "radar" }> }) {
  const frame = frames.get(block.from);

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  const { points, entities, missing } = radarPoints(frame.rows, block.entity, block.axes, block.series);

  if (entities.length === 0) {
    return (
      <Shell block={block} placement={placement}>
        <Empty reason={`none of ${block.series.join(", ")} is in "${block.from}"`} />
      </Shell>
    );
  }

  // Stated at every rung, not only at full size: an entity the spec asked for
  // and the frame does not hold is missing from the comparison either way.
  const note = missing.length > 0 ? <p className="shrink-0 truncate text-[10px] text-muted-foreground/70">{missing.join(", ")} not in this frame</p> : null;

  if (placement.variant === "radar.bars") {
    return (
      <Shell block={block} placement={placement}>
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            {/* The polygon prettifies its axis names through a tickFormatter;
                the rung has no axis, so the labels are prettified on the way in
                and `change_safety` reads the same in both forms. */}
            <RadarBars points={points.map((p) => ({ ...p, axis: prettify(String(p.axis)) }))} entities={entities} max={block.max} />
          </div>
          {note}
        </div>
      </Shell>
    );
  }

  return (
    <Shell block={block} placement={placement}>
      <div className="flex h-full flex-col">
        <ChartContainer
          config={buildConfig(entities)}
          /* aspect-[unset] overrides ChartContainer's aspect-video, which would
             re-derive a width from the height the solver just assigned. */
          className="min-h-0 w-full flex-1 aspect-[unset]"
        >
          <RadarChart data={points} outerRadius="72%">
            <PolarGrid />
            <PolarAngleAxis dataKey="axis" tick={{ ...axisStyle, fontSize: 9.5 }} tickFormatter={(v) => prettify(String(v))} />
            {/* Fixed 0–max, never auto. An auto radius axis rescales to whatever
                the selected entities happen to span, so the same service draws a
                different shape depending on who it is compared against — and the
                silhouette, which is the entire point of the form, stops meaning
                anything across cards. */}
            <PolarRadiusAxis domain={[0, block.max]} tick={false} axisLine={false} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(v, n) => (
                    <div className="flex w-full justify-between gap-3">
                      <span className="text-muted-foreground">{String(n ?? "")}</span>
                      <span className="font-medium tabular-nums">
                        {Math.round(Number(v))}<span className="text-muted-foreground">/{block.max}</span>
                      </span>
                    </div>
                  )}
                />
              }
            />
            {entities.map((e, i) => (
              <Radar
                key={e}
                name={e}
                dataKey={e}
                stroke={seriesColor(i)}
                strokeWidth={1.75}
                fill={seriesColor(i)}
                /* Under 15%: three overlapping shapes have to stay individually
                   readable, which a heavier fill makes impossible. */
                fillOpacity={0.13}
                isAnimationActive={false}
              />
            ))}
          </RadarChart>
        </ChartContainer>

        {/* Identity never rests on colour alone, and three polygons in one frame
            are indistinguishable without a key. Rendered here rather than as a
            Recharts legend so its height is a known 18px the plot can budget. */}
        {entities.length > 1 && (
          <ul className="flex shrink-0 flex-wrap gap-x-3 pt-1 text-[10px]">
            {entities.map((e, i) => (
              <li key={e} className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: seriesColor(i) }} aria-hidden />
                <span className="truncate text-muted-foreground">{e}</span>
              </li>
            ))}
          </ul>
        )}
        {note}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Radial
 * ------------------------------------------------------------------ */

/**
 * Six arcs.
 *
 * Not a geometric limit but the palette's: a seventh ring would have to reach
 * outside the validated six, and the size contract already budgets ~14px of
 * ring each. Anything past six is stated rather than dropped.
 */
const MAX_RINGS = 6;

export function RadialBlock({
  block,
  placement,
  frames,
}: BlockProps & { block: Extract<Block, { kind: "radial" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  if (placement.variant === "radial.bar") {
    return (
      <Shell block={block} placement={placement}>
        <RadialBars
          rows={frame.rows}
          category={block.category}
          value={block.value}
          max={block.max}
          warnAt={block.warnAt}
          critAt={block.critAt}
          format={block.format}
          maxItems={a.maxItems}
        />
      </Shell>
    );
  }

  const shown = frame.rows.slice(0, MAX_RINGS);
  const dropped = frame.rows.length - shown.length;

  const data = shown.map((r, i) => {
    const v = Number(r[block.value]) || 0;
    // A gauge breaches by FALLING — "62% of the error budget remains" is bad at
    // 5, not at 95 — so the thresholds are floors and `inverse` is true here.
    const tint = statusTint(v, block.warnAt, block.critAt, true);
    return {
      name: String(r[block.category] ?? "—"),
      value: v,
      word: statusWord(v, block.warnAt, block.critAt, true),
      fill: tint ?? seriesColor(i),
    };
  });

  const sideLegend = a.legendSide === "right";
  const legendW = sideLegend ? Math.min(170, placement.w * 0.42) : 0;
  // Explicit widths rather than flex-1: a Recharts container reports an
  // intrinsic width, and a flex sibling without min-width:0 refuses to shrink
  // below it. Sizing both from the solver's rect removes the negotiation.
  const plotW = placement.w - 32 - legendW;

  const chart = (
    <ChartContainer config={buildConfig(data.map((d) => d.name))} className="h-full w-full aspect-[unset]">
      <RadialBarChart data={data} innerRadius="26%" outerRadius="96%" startAngle={90} endAngle={-270}>
        <PolarAngleAxis type="number" domain={[0, block.max]} tick={false} />
        <RadialBar dataKey="value" cornerRadius={4} background isAnimationActive={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              nameKey="name"
              formatter={(v, n) => (
                <div className="flex w-full justify-between gap-3">
                  <span className="text-muted-foreground">{String(n ?? "")}</span>
                  <span className="font-medium tabular-nums">
                    {formatValue(Number(v), block.format)}
                    <span className="ml-1 text-muted-foreground">of {block.max}</span>
                  </span>
                </div>
              )}
            />
          }
        />
      </RadialBarChart>
    </ChartContainer>
  );

  const legend = (
    <ul className="min-w-0 space-y-1 text-xs" style={sideLegend ? { width: legendW } : undefined}>
      {data.map((d) => (
        <li key={d.name} className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: d.fill }} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.name}</span>
          {/* The word beside the colour: an amber ring means nothing to a reader
              who cannot separate it from red, and this list is read at 3am. */}
          {d.word && <span className="shrink-0 text-[9px] uppercase tracking-wider" style={{ color: d.fill }}>{d.word}</span>}
          <span className="shrink-0 tabular-nums">{formatValue(d.value, block.format)}</span>
        </li>
      ))}
      {dropped > 0 && (
        <li className="pt-0.5 text-[10px] text-muted-foreground/70">+ {dropped} more not shown — six arcs is the palette's limit</li>
      )}
    </ul>
  );

  return (
    <Shell block={block} placement={placement}>
      {sideLegend ? (
        <div className="flex h-full items-center gap-3">
          <div className="h-full shrink-0" style={{ width: plotW }}>{chart}</div>
          {legend}
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 w-full flex-1">{chart}</div>
          <div className="w-full shrink-0 pt-1">{legend}</div>
        </div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Callout
 * ------------------------------------------------------------------ */

export function CalloutBlock({
  block,
  placement,
  frames,
}: BlockProps & { block: Extract<Block, { kind: "callout" }> }) {
  const a = placement.affordances;
  const { from, titleField, detailField, metaField, severityField, rankField } = block;

  const items = React.useMemo<CalloutItem[]>(() => {
    const rows = frames.get(from)?.rows ?? [];
    // Descending, because the order IS the product: at 3am the only question is
    // what to look at first, and an unranked grid answers it with "whichever you
    // happen to notice". Absent `rankField`, table order is already the ranking.
    const sorted = rankField
      ? [...rows].sort((x, y) => Number(y[rankField] ?? 0) - Number(x[rankField] ?? 0))
      : rows;

    return sorted.map((r, i) => ({
      key: `${i}-${String(r[titleField] ?? "")}`,
      title: String(r[titleField] ?? "—"),
      detail: detailField ? String(r[detailField] ?? "") : undefined,
      meta: metaField ? String(r[metaField] ?? "") : undefined,
      // The producer's own word, shown verbatim. Mapping "breach" onto our own
      // label would rename the reader's data on the way to the screen.
      severity: String(r[severityField] ?? ""),
    }));
  }, [frames, from, titleField, detailField, metaField, severityField, rankField]);

  if (placement.variant === "callout.count") {
    return (
      <Shell block={block} placement={placement}>
        <CalloutCount items={items} emptyText={block.emptyText} />
      </Shell>
    );
  }

  if (placement.variant === "callout.compact") {
    return (
      <Shell block={block} placement={placement}>
        <CalloutCompact items={items} maxItems={a.maxItems} emptyText={block.emptyText} />
      </Shell>
    );
  }

  if (items.length === 0) {
    return (
      <Shell block={block} placement={placement}>
        <CalloutEmpty text={block.emptyText} />
      </Shell>
    );
  }

  const shown = items.slice(0, block.limit);
  const dropped = items.length - shown.length;

  return (
    <Shell block={block} placement={placement}>
      <ol className="flex h-full flex-col gap-1.5 overflow-hidden">
        {shown.map((item) => {
          const style = severityStyle(severityOf(item.severity));
          const Icon = style.Icon;
          return (
            <li
              key={item.key}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border bg-background/40 px-3 py-2 transition-colors hover:bg-background/70",
                style.ring,
              )}
            >
              <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: style.tint }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.title}</p>
                  {/* The word, not just the hue — a banner that means something
                      only if you can tell red from amber fails the person most
                      likely to need it. */}
                  <span
                    className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium uppercase tracking-wider"
                    style={{ color: style.tint, background: `color-mix(in oklab, ${style.tint} 14%, transparent)` }}
                  >
                    {item.severity || "unknown"}
                  </span>
                </div>
                {item.detail && a.subtitle && (
                  <p className="mt-0.5 truncate text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p>
                )}
              </div>
              {item.meta && a.valueLabels && (
                <span className="shrink-0 self-center text-[10px] tabular-nums text-muted-foreground/70">{item.meta}</span>
              )}
            </li>
          );
        })}
        {dropped > 0 && (
          <li className="mt-auto pt-1 text-[10px] text-muted-foreground">
            {shown.length} of {items.length} shown — the {dropped} below the cut are lower ranked, not resolved
          </li>
        )}
      </ol>
    </Shell>
  );
}
