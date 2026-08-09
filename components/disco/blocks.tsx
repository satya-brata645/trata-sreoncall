"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { aggregate, type Row } from "@disco/core/algebra";
import { formatTick, formatTimeTick, formatValue, pctChange, type Format } from "@disco/core/format";
import type { BlockVariant } from "@disco/core/contracts";
import { seriesOf, seriesFields, type Block } from "@disco/core/spec";

import { VirtualTable } from "./virtual-table";
import { BarList, RowStripHeatmap, ShareBar, SparkBars, SparklineTimeseries, Top5Table, WARN_HUE, statusTint } from "./rungs";
import {
  CalloutBlock,
  Empty,
  FunnelBlock,
  RadarBlock,
  RadialBlock,
  Shell,
  axisStyle,
  bodyHeight,
  buildConfig,
  prettify,
  seriesColor,
  type BlockProps,
} from "./blocks-extra";

/**
 * The block catalog.
 *
 * Nothing here decides its own size. Every component receives `w`, `h`, its
 * `variant` and an `affordances` record from the layout solver, and renders
 * exactly what it was told it has room for. That inversion is the whole point:
 * a component that guesses its own height cannot participate in a layout that
 * has to fit a window the user is actively dragging.
 *
 * This file is also the ceiling of what a generated dashboard can be. The agent
 * composes from this vocabulary and cannot render outside it, which is the
 * correctness model rather than a limitation.
 *
 * `Shell`, `prettify` and the rest of the card primitives live in
 * `blocks-extra.tsx` alongside the four newest kinds, so that the import runs
 * one way and the two halves of the catalog cannot form a cycle. They are
 * re-exported here because this file is still the catalog's front door.
 */

export { prettify, type BlockProps };

/* ------------------------------------------------------------------ *
 * KPI
 * ------------------------------------------------------------------ */

/**
 * A unit string from the data, mapped onto how the number should read.
 *
 * `unitField` points at a column an upstream producer already wrote, and its
 * vocabulary is the producer's rather than `Format`'s. Two of them map cleanly;
 * the rest do not, and are rendered as a suffix instead of being forced into
 * the nearest `Format` — `min` in particular must NOT become `duration`, whose
 * formatter reads milliseconds and would render 42 minutes as "42 ms".
 */
function unitFormat(unit: string, fallback: Format): { format: Format; suffix?: string } {
  const u = unit.trim().toLowerCase();
  switch (u) {
    // Already a Format name: the producer and the renderer agree, use it.
    case "number": case "compact": case "usd": case "percent": case "bytes": case "ms": case "duration":
      return { format: u };
    case "pct": case "%": case "percentage":
      return { format: "percent" };
    case "count": case "": case "n":
      return { format: "number" };
    case "$": case "dollars": case "usd_cents":
      return { format: "usd" };
    case "min": case "mins": case "minutes":
      return { format: "number", suffix: " min" };
    case "h": case "hrs": case "hours":
      return { format: "number", suffix: " h" };
    case "ratio":
      return { format: "number", suffix: ":1" };
    case "x": case "×":
      return { format: "number", suffix: "×" };
    default:
      // An unknown unit is still information. Printing it beside the number is
      // strictly better than dropping it and letting the reader assume "count".
      return { format: fallback, suffix: ` ${unit}` };
  }
}

/** Producers write booleans as `true`, `"true"` and `1` interchangeably. */
function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function KpiBlock({ block, placement, frames }: BlockProps & { block: Extract<Block, { kind: "kpi" }> }) {
  const frame = frames.get(block.from);
  const spark = block.spark ? frames.get(block.spark.from) : undefined;
  const variant = placement.variant;

  if (!frame) return <Shell block={block} placement={placement}><Empty reason={`missing frame "${block.from}"`} /></Shell>;

  const value = aggregate(frame.rows.map((r) => r[block.field]), block.agg);

  /*
   * Field bindings read the FIRST row of the bound frame.
   *
   * A label, a unit or a breach flag is not aggregable — there is no `sum` of
   * "Median time to acknowledge" — so a spec that uses these has necessarily
   * filtered `from` down to the one metric row it is describing. Reading row
   * zero is therefore reading the row the spec pointed at; against an
   * unfiltered frame it is the first metric's chrome, which is why the
   * bindings are opt-in and the literals stay the default.
   */
  const row = frame.rows[0] as Row | undefined;
  const bound = (field: string | undefined): unknown => (field && row ? row[field] : undefined);

  const boundLabel = bound(block.labelField);
  const boundUnit = bound(block.unitField);
  const { format, suffix } =
    boundUnit === undefined || boundUnit === null
      ? { format: block.format, suffix: undefined as string | undefined }
      : unitFormat(String(boundUnit), block.format);

  /** The suffix never lands on an em dash: "— min" reads as a broken value. */
  const fmt = (v: unknown) => {
    const shown = formatValue(v, format);
    return shown === "—" || !suffix ? shown : `${shown}${suffix}`;
  };

  // The comparison runs over the sparkline frame, which is already bucketed —
  // "previous" means the previous bucket, not the previous row.
  let delta: number | null = null;
  if (block.compare?.mode === "previous" && spark && block.spark) {
    const series = spark.rows.map((r) => Number(r[block.spark!.y])).filter((v) => Number.isFinite(v));
    if (series.length >= 2) delta = pctChange(series[series.length - 1], series[series.length - 2]);
  } else if (block.compare?.mode === "target" && block.compare.target !== undefined && typeof value === "number") {
    delta = pctChange(value, block.compare.target);
  }

  // A producer that already computed the change against its own previous window
  // knows the comparison better than a re-derivation from the sparkline can.
  const boundDelta = bound(block.deltaField);
  if (block.deltaField) {
    const d = Number(boundDelta);
    delta = boundDelta === null || boundDelta === undefined || !Number.isFinite(d) ? null : d;
  }

  // `inverse` is load-bearing: MTTR falling is good, availability falling is
  // not. Getting the direction wrong paints a fire green, which is worse than
  // showing no delta at all.
  const inverse = block.inverseField ? truthy(bound(block.inverseField)) : (block.compare?.inverse ?? false);
  const breach = block.breachField ? truthy(bound(block.breachField)) : false;
  const basis = block.basisField ? String(bound(block.basisField) ?? "") : "";
  const meaning = block.meaningField ? String(bound(block.meaningField) ?? "") : "";

  // The basis is always one hover away: "68%" of what is the difference between
  // a number and a claim.
  const hover =
    [meaning, basis && `Basis: ${basis}`, breach && "Breaching target."]
      .filter((s): s is string => Boolean(s))
      .join("\n\n") || undefined;

  const good = delta === null ? null : inverse ? delta < 0 : delta > 0;
  const DeltaIcon = delta === null ? Minus : delta >= 0 ? ArrowUpRight : ArrowDownRight;
  const label =
    boundLabel === undefined || boundLabel === null
      ? block.title
        ? prettify(block.title)
        : prettify(block.field)
      : String(boundLabel);

  const deltaChip = delta !== null && (
    <span
      className={cn(
        "flex items-center gap-0.5 text-xs font-medium tabular-nums",
        good === null && "text-muted-foreground",
        good === true && "text-[var(--disco-positive)]",
        good === false && "text-[var(--disco-negative)]",
      )}
    >
      <DeltaIcon className="size-3" aria-hidden />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );

  // A breach is never colour-alone: the ring carries a dot beside the label and
  // the word in the tooltip, because the person reading this may be colourblind,
  // on a bad screen, or both.
  const breachRing = breach ? "border-[var(--disco-negative)]/45" : "border-border/70";
  const breachDot = breach && (
    <span className="size-1.5 shrink-0 rounded-full bg-[var(--disco-negative)]" aria-label="Breaching target" />
  );

  // The narrowest rung: label and value share one baseline.
  if (variant === "kpi.inline") {
    return (
      <section className={cn("flex h-full items-center justify-between gap-2 rounded-xl border bg-card px-3", breachRing)} title={hover}>
        <span className="flex min-w-0 items-center gap-1.5">
          {breachDot}
          <span className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        </span>
        <span className="shrink-0 text-base font-semibold tabular-nums">{fmt(value)}</span>
      </section>
    );
  }

  const showSpark = variant === "kpi" && spark && block.spark;

  return (
    <section className={cn("flex h-full flex-col justify-center rounded-xl border bg-card px-4 py-3", breachRing)} title={hover}>
      <div className="flex items-center gap-1.5">
        {breachDot}
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {fmt(value)}
        </span>
        {deltaChip}
      </div>

      {showSpark && (
        <div className="mt-2 h-[44px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark!.rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${block.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={seriesColor(0)} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={seriesColor(0)} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                dataKey={block.spark!.y}
                type="monotone"
                stroke={seriesColor(0)}
                strokeWidth={1.5}
                fill={`url(#spark-${block.id})`}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {variant === "kpi" && (
        <p className="mt-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {/* The stated denominator beats the aggregate name when there is one:
              "of 312 alerts" answers a question that "sum" does not. */}
          {basis || (
            <>
              {block.agg}
              {block.compare?.mode === "previous" && delta !== null ? " · vs previous period" : ""}
            </>
          )}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Time series
 * ------------------------------------------------------------------ */

function TimeseriesBlock({
  block,
  placement,
  frames,
  granularity,
}: BlockProps & { block: Extract<Block, { kind: "timeseries" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  if (placement.variant === "timeseries.sparkline") {
    return (
      <Shell block={block} placement={placement}>
        <SparklineTimeseries
          rows={frame.rows}
          x={block.x}
          y={seriesFields(block)[0]}
          format={block.format}
          height={bodyHeight(placement.h, a)}
        />
      </Shell>
    );
  }

  // One shape for every series, whether the spec wrote a bare field name or an
  // object with its own mark.
  const series = seriesOf(block);
  const config = buildConfig(series.map((s) => s.field));
  const Chart = block.mark === "bar" ? BarChart : block.mark === "area" ? AreaChart : LineChart;

  return (
    <Shell block={block} placement={placement}>
      <ChartContainer config={config} className="h-full w-full">
        <Chart data={frame.rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          {a.grid && <CartesianGrid vertical={false} />}
          {a.xAxis && (
            <XAxis
              dataKey={block.x}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={28}
              tick={axisStyle}
              interval="preserveStartEnd"
              tickFormatter={(v) => formatTimeTick(v, granularity)}
            />
          )}
          {a.yAxis && (
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tick={axisStyle}
              tickCount={a.maxTicksY}
              scale={block.yScale === "log" ? "log" : "auto"}
              domain={block.yScale === "log" ? ["auto", "auto"] : undefined}
              tickFormatter={(v) => formatTick(v, block.format)}
            />
          )}
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v) => formatTimeTick(v, granularity)}
                formatter={(value, name) => (
                  <div className="flex w-full justify-between gap-3">
                    <span className="text-muted-foreground">{prettify(String(name))}</span>
                    <span className="font-medium tabular-nums">{formatValue(value as number, block.format)}</span>
                  </div>
                )}
              />
            }
          />
          {a.legend && <ChartLegend content={<ChartLegendContent />} />}

          {series.map(({ field: key, mark, stack }, i) =>
            mark === "bar" ? (
              <Bar key={key} dataKey={key} fill={seriesColor(i)} radius={[4, 4, 0, 0]} stackId={stack ? "s" : undefined} isAnimationActive={false} />
            ) : mark === "area" ? (
              <Area
                key={key}
                dataKey={key}
                type="monotone"
                stroke={seriesColor(i)}
                strokeWidth={2}
                fill={seriesColor(i)}
                /* Under 15%: a fill must read as a tint, never a colour field. */
                fillOpacity={0.14}
                stackId={stack ? "s" : undefined}
                dot={false}
                connectNulls={block.connectNulls}
                isAnimationActive={false}
              />
            ) : (
              <Line key={key} dataKey={key} type="monotone" stroke={seriesColor(i)} strokeWidth={2} dot={false} connectNulls={block.connectNulls} isAnimationActive={false} />
            ),
          )}
        </Chart>
      </ChartContainer>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Bar
 * ------------------------------------------------------------------ */

function BarBlock({ block, placement, frames }: BlockProps & { block: Extract<Block, { kind: "bar" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  if (placement.variant === "bar.list") {
    return (
      <Shell block={block} placement={placement}>
        <BarList rows={frame.rows} category={block.x} value={block.y[0]} format={block.format} maxItems={a.maxItems} />
      </Shell>
    );
  }

  // The solver decides orientation; the spec only expresses a preference.
  const horizontal = placement.variant === "bar.horizontal" || placement.variant === "bar.top5" || block.orientation === "horizontal";
  const rows = a.maxItems ? [...frame.rows].sort((x, y) => Number(y[block.y[0]] ?? 0) - Number(x[block.y[0]] ?? 0)).slice(0, a.maxItems) : frame.rows;
  const config = buildConfig(block.y);

  /*
   * Colour follows the ENTITY, not its position.
   *
   * The obvious implementation — colour bar 0 red, bar 1 amber — makes the
   * palette a function of rank, so applying a filter that removes the worst
   * service repaints every survivor and the second-worst suddenly looks
   * critical. Reading the tint from a second column instead means a service
   * that is fine stays blue however high it climbs the list, and the colours
   * are stable across every filter the reader applies.
   *
   * Only when there is a single measure: with two series, colour is already
   * carrying series identity, and overloading it would make the legend a lie.
   */
  const colorBy = block.colorBy && block.y.length === 1 ? block.colorBy : undefined;
  const cellTints = colorBy
    ? rows.map((r) => statusTint(Number(r[colorBy.field]), colorBy.warnAt, colorBy.critAt, colorBy.inverse) ?? seriesColor(0))
    : null;

  // Every coloured mark keeps a legend entry. A bar chart where red means
  // something the card never states is decoration wearing a status hue.
  const colorKey = colorBy && (
    <ul className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 pt-1 text-[10px] text-muted-foreground">
      <li className="font-medium">{prettify(colorBy.field)}</li>
      <li className="flex items-center gap-1">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: seriesColor(0) }} aria-hidden />
        within tolerance
      </li>
      <li className="flex items-center gap-1">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: WARN_HUE }} aria-hidden />
        at risk {colorBy.inverse ? "≤" : "≥"} {colorBy.warnAt}
      </li>
      <li className="flex items-center gap-1">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: "var(--disco-negative)" }} aria-hidden />
        critical {colorBy.inverse ? "≤" : "≥"} {colorBy.critAt}
      </li>
    </ul>
  );

  const chart = (
    <ChartContainer config={config} className={cn("w-full", colorKey ? "min-h-0 flex-1 aspect-[unset]" : "h-full")}>
      <BarChart
        data={rows}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 16, bottom: 0, left: horizontal ? 8 : 4 }}
      >
        {a.grid && <CartesianGrid horizontal={!horizontal} vertical={horizontal} />}
        {horizontal ? (
          <>
            {a.xAxis && <XAxis type="number" tickLine={false} axisLine={false} tick={axisStyle} tickFormatter={(v) => formatTick(v, block.format)} />}
            <YAxis
              type="category"
              dataKey={block.x}
              tickLine={false}
              axisLine={false}
              width={Math.min(132, Math.max(60, placement.w * 0.32))}
              tick={axisStyle}
              tickFormatter={(v) => String(v ?? "").slice(0, 22)}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={block.x} tickLine={false} axisLine={false} tickMargin={8} tick={axisStyle} interval="preserveStartEnd" tickFormatter={(v) => String(v ?? "").slice(0, 14)} />
            {a.yAxis && <YAxis tickLine={false} axisLine={false} width={52} tick={axisStyle} tickCount={a.maxTicksY} tickFormatter={(v) => formatTick(v, block.format)} />}
          </>
        )}
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full justify-between gap-3">
                  <span className="text-muted-foreground">{prettify(String(name))}</span>
                  <span className="font-medium tabular-nums">{formatValue(value as number, block.format)}</span>
                </div>
              )}
            />
          }
        />
        {a.legend && <ChartLegend content={<ChartLegendContent />} />}
        {block.y.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            fill={seriesColor(i)}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            stackId={block.stack ? "s" : undefined}
            isAnimationActive={false}
          >
            {cellTints?.map((fill, j) => (
              <Cell key={j} fill={fill} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );

  return (
    <Shell block={block} placement={placement}>
      {colorKey ? (
        <div className="flex h-full flex-col">
          {chart}
          {colorKey}
        </div>
      ) : (
        chart
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Donut
 * ------------------------------------------------------------------ */

function PieBlock({ block, placement, frames }: BlockProps & { block: Extract<Block, { kind: "pie" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  const rows = [...frame.rows].sort((x, y) => Number(y[block.value] ?? 0) - Number(x[block.value] ?? 0));
  const total = rows.reduce((acc, r) => acc + (Number(r[block.value]) || 0), 0);

  if (placement.variant === "pie.share_bar") {
    return (
      <Shell block={block} placement={placement}>
        <ShareBar rows={rows} category={block.category} value={block.value} format={block.format} />
      </Shell>
    );
  }

  const body = bodyHeight(placement.h, a);
  const sideLegend = a.legendSide === "right";
  const legendW = sideLegend ? Math.min(180, placement.w * 0.42) : 0;
  // The circle is sized to whatever the card actually gives it, which is why
  // the pie contract carries no aspect band.
  const plotW = placement.w - 32 - legendW;
  const outer = Math.max(52, Math.min(plotW, sideLegend ? body : body - rows.length * 18) / 2 - 6);

  const legend = (
    <ul className="min-w-0 space-y-1 text-xs" style={sideLegend ? { width: legendW } : undefined}>
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: seriesColor(i) }} aria-hidden />
          <span className="truncate text-muted-foreground">{String(r[block.category])}</span>
          <span className="ml-auto shrink-0 tabular-nums">{formatValue(r[block.value], block.format)}</span>
        </li>
      ))}
    </ul>
  );

  const chart = (
    <ChartContainer
      config={buildConfig(rows.map((r) => String(r[block.category])))}
      /* aspect-[unset] overrides ChartContainer's default aspect-video, which
         would otherwise re-derive a width from the height we just assigned. */
      className="h-full w-full aspect-[unset]"
    >
      <PieChart>
        <ChartTooltip
          content={
            <ChartTooltipContent
              nameKey={block.category}
              formatter={(value, name) => (
                <div className="flex w-full justify-between gap-3">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="font-medium tabular-nums">
                    {formatValue(value as number, block.format)}
                    <span className="ml-1 text-muted-foreground">({total ? ((Number(value) / total) * 100).toFixed(0) : 0}%)</span>
                  </span>
                </div>
              )}
            />
          }
        />
        <Pie
          data={rows}
          dataKey={block.value}
          nameKey={block.category}
          innerRadius={block.donut ? Math.max(28, outer * 0.62) : 0}
          outerRadius={outer}
          /* A 2px surface gap keeps adjacent slices from bleeding together. */
          paddingAngle={1.5}
          stroke="var(--card)"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {rows.map((_, i) => (
            <Cell key={i} fill={seriesColor(i)} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );

  return (
    <Shell block={block} placement={placement}>
      {/* Identity is never colour-alone: every slice is named and valued. */}
      {sideLegend ? (
        // Explicit widths, not flex-1. A Recharts container reports an intrinsic
        // width, and a flex sibling without `min-width: 0` refuses to shrink
        // below it — which collapsed the legend to zero and pushed the chart
        // past the card edge. Sizing both from the solver's rect removes the
        // negotiation entirely.
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
 * Histogram
 * ------------------------------------------------------------------ */

function HistogramBlock({ block, placement, frames }: BlockProps & { block: Extract<Block, { kind: "histogram" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  if (placement.variant === "histogram.sparkbars") {
    return (
      <Shell block={block} placement={placement}>
        <SparkBars rows={frame.rows} y={block.y} height={bodyHeight(placement.h, a)} />
      </Shell>
    );
  }

  return (
    <Shell block={block} placement={placement}>
      <ChartContainer config={buildConfig([block.y])} className="h-full w-full">
        <BarChart data={frame.rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          {a.grid && <CartesianGrid vertical={false} />}
          {a.xAxis && <XAxis dataKey={block.x} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tick={axisStyle} interval="preserveStartEnd" />}
          {a.yAxis && <YAxis tickLine={false} axisLine={false} width={44} tick={axisStyle} tickCount={a.maxTicksY} tickFormatter={(v) => formatTick(v, "compact")} />}
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v) => `bin starting ${v}`}
                formatter={(value) => (
                  <div className="flex w-full justify-between gap-3">
                    <span className="text-muted-foreground">Rows</span>
                    <span className="font-medium tabular-nums">{formatValue(value as number, "compact")}</span>
                  </div>
                )}
              />
            }
          />
          {/* One distribution, one hue — bins are not separate identities. */}
          <Bar dataKey={block.y} fill={seriesColor(0)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Scatter
 * ------------------------------------------------------------------ */

function ScatterBlock({ block, placement, frames }: BlockProps & { block: Extract<Block, { kind: "scatter" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  const groups = React.useMemo(() => {
    const rows = frame?.rows ?? [];
    if (!block.colorBy) return [{ name: prettify(block.y), rows }];
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const k = String(r[block.colorBy] ?? "—");
      const bucket = map.get(k);
      if (bucket) bucket.push(r);
      else map.set(k, [r]);
    }
    // All-pairs colour separation only validates to three slots, and a scatter
    // compares every pair at once — so three groups, then fold.
    return [...map.entries()].slice(0, 3).map(([name, rows]) => ({ name, rows }));
  }, [frame, block.colorBy, block.y]);

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  return (
    <Shell block={block} placement={placement}>
      <ChartContainer config={buildConfig(groups.map((g) => g.name))} className="h-full w-full">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          {a.grid && <CartesianGrid />}
          {a.xAxis && (
            <XAxis
              type="number"
              dataKey={block.x}
              name={prettify(block.x)}
              tickLine={false}
              axisLine={false}
              tick={axisStyle}
              scale={block.xScale === "log" ? "log" : "auto"}
              domain={block.xScale === "log" ? ["auto", "auto"] : undefined}
              tickFormatter={(v) => formatTick(v, "compact")}
            />
          )}
          {a.yAxis && (
            <YAxis
              type="number"
              dataKey={block.y}
              name={prettify(block.y)}
              tickLine={false}
              axisLine={false}
              width={52}
              tick={axisStyle}
              tickCount={a.maxTicksY}
              scale={block.yScale === "log" ? "log" : "auto"}
              domain={block.yScale === "log" ? ["auto", "auto"] : undefined}
              tickFormatter={(v) => formatTick(v, "compact")}
            />
          )}
          {block.size && <ZAxis type="number" dataKey={block.size} range={[24, 220]} />}
          <ChartTooltip content={<ChartTooltipContent />} />
          {a.legend && groups.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
          {groups.map((g, i) => (
            /* Overplotting is inevitable; low opacity turns it into density. */
            <Scatter key={g.name} name={g.name} data={g.rows} fill={seriesColor(i)} fillOpacity={0.5} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ChartContainer>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Heatmap
 * ------------------------------------------------------------------ */

function HeatmapBlock({ block, placement, frames }: BlockProps & { block: Extract<Block, { kind: "heatmap" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  if (!frame || frame.rows.length === 0) {
    return <Shell block={block} placement={placement}><Empty reason="no rows in this frame" /></Shell>;
  }

  if (placement.variant === "heatmap.rowstrip") {
    return (
      <Shell block={block} placement={placement}>
        <RowStripHeatmap rows={frame.rows} y={block.y} value={block.value} format={block.format} maxItems={a.maxItems} />
      </Shell>
    );
  }

  const xs = [...new Set(frame.rows.map((r) => String(r[block.x])))];
  const ys = [...new Set(frame.rows.map((r) => String(r[block.y])))];
  const max = Math.max(...frame.rows.map((r) => Number(r[block.value]) || 0), 1);
  const lookup = new Map(frame.rows.map((r) => [`${r[block.x]}|${r[block.y]}`, Number(r[block.value]) || 0]));

  return (
    <Shell block={block} placement={placement}>
      <div className="h-full overflow-auto">
        <div className="inline-grid gap-px" style={{ gridTemplateColumns: `auto repeat(${xs.length}, minmax(28px, 1fr))` }}>
          <div />
          {xs.map((x) => (
            <div key={x} className="truncate px-1 pb-1 text-center text-[10px] text-muted-foreground">{x}</div>
          ))}
          {ys.map((y) => (
            <React.Fragment key={y}>
              <div className="pr-2 text-right text-[10px] leading-6 text-muted-foreground">{y}</div>
              {xs.map((x) => {
                const v = lookup.get(`${x}|${y}`) ?? 0;
                return (
                  <div
                    key={`${x}|${y}`}
                    title={`${x} · ${y}: ${formatValue(v, block.format)}`}
                    className="h-6 rounded-[2px]"
                    /* Sequential magnitude: one hue, light to dark. Never a rainbow. */
                    style={{ background: `color-mix(in oklab, var(--color-role-sequential-hue) ${Math.round((v / max) * 100)}%, var(--card))` }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Table & narrative
 * ------------------------------------------------------------------ */

function TableBlock({ block, placement, frames }: BlockProps & { block: Extract<Block, { kind: "table" }> }) {
  const frame = frames.get(block.from);
  const a = placement.affordances;

  if (!frame) return <Shell block={block} placement={placement}><Empty reason={`missing frame "${block.from}"`} /></Shell>;

  const columns = block.columns.map((c) => ({
    field: c.field,
    label: c.label ?? prettify(c.field),
    format: c.format as Format | undefined,
    align: (c.align ?? "left") as "left" | "right",
  }));

  if (placement.variant === "table.top5") {
    return (
      <Shell block={block} placement={placement}>
        <Top5Table rows={frame.rows} columns={columns} maxItems={a.maxItems} />
      </Shell>
    );
  }

  return (
    <Shell block={block} placement={placement}>
      <VirtualTable
        rows={frame.rows}
        columns={columns}
        virtualize={block.virtualize}
        pageSize={block.pageSize}
        height={bodyHeight(placement.h, a)}
      />
    </Shell>
  );
}

function TextBlock({ block, placement }: BlockProps & { block: Extract<Block, { kind: "text" }> }) {
  const tone =
    block.tone === "warning"
      ? "border-[var(--disco-negative)]/40 bg-[var(--disco-negative)]/5"
      : block.tone === "insight"
        ? "border-[var(--disco-accent)]/40 bg-[var(--disco-accent)]/5"
        : "border-border/70 bg-card";

  return (
    <section className={cn("flex h-full flex-col justify-center overflow-hidden rounded-xl border px-4 py-3", tone)}>
      {block.title && placement.affordances.title && <p className="mb-1 text-sm font-medium">{block.title}</p>}
      <p
        className={cn(
          "text-sm leading-relaxed text-muted-foreground",
          placement.variant === "text.clamped" && "line-clamp-1",
        )}
      >
        {block.body}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

export function DiscoBlock(props: BlockProps & { showReason?: boolean }) {
  const { block, placement, showReason } = props;

  const body = (() => {
    switch (block.kind) {
      case "kpi": return <KpiBlock {...props} block={block} />;
      case "timeseries": return <TimeseriesBlock {...props} block={block} />;
      case "bar": return <BarBlock {...props} block={block} />;
      case "pie": return <PieBlock {...props} block={block} />;
      case "histogram": return <HistogramBlock {...props} block={block} />;
      case "scatter": return <ScatterBlock {...props} block={block} />;
      case "heatmap": return <HeatmapBlock {...props} block={block} />;
      case "table": return <TableBlock {...props} block={block} />;
      case "funnel": return <FunnelBlock {...props} block={block} />;
      case "radar": return <RadarBlock {...props} block={block} />;
      case "radial": return <RadialBlock {...props} block={block} />;
      case "callout": return <CalloutBlock {...props} block={block} />;
      case "text": return <TextBlock {...props} block={block} />;
      default:
        // Unreachable while the schema and this switch agree — and if they ever
        // drift, an unknown kind degrades to a note instead of crashing.
        return <Empty reason={`unknown block kind "${(block as { kind: string }).kind}"`} />;
    }
  })();

  const degraded = placement.degradedFrom;
  if (!showReason && !degraded) return body;

  return (
    <div className="relative h-full">
      {body}
      {/* Degradation is never silent — the badge says what changed and why. */}
      {degraded && (
        <Badge
          variant="outline"
          className="absolute right-3 top-3 max-w-[70%] truncate border-[var(--disco-accent)]/40 text-[10px] font-normal"
          title={`Simplified from ${degraded}: ${placement.degradeReason ?? ""}`}
        >
          simplified · widen to restore
        </Badge>
      )}
      {showReason && !degraded && block.reason && (
        <Badge variant="secondary" className="absolute right-3 top-3 max-w-[70%] truncate text-[10px] font-normal" title={block.reason}>
          {block.reason}
        </Badge>
      )}
    </div>
  );
}

export type { BlockVariant };
