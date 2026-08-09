import type { FormatSchema } from "./spec";
import { z } from "zod";

export type Format = z.infer<typeof FormatSchema>;

/**
 * Number formatting lives in core, not in the renderer, so a value shown on a
 * tile and the same value in a tooltip or a table cell can never disagree.
 */

/**
 * `trailingZeroDisplay` is pinned on every compact formatter deliberately.
 * Node and Chrome ship different ICU builds whose compact-notation defaults
 * disagree — Node renders 7_000_000 as "$7.0M", Chrome as "$7M" — which shows
 * up as a React hydration mismatch on any server-rendered figure. Stating the
 * rule makes both runtimes agree instead of relying on their defaults.
 */
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
  trailingZeroDisplay: "stripIfInteger",
});
const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
  trailingZeroDisplay: "stripIfInteger",
});

export function formatValue(value: unknown, format: Format = "number"): string {
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    value = n;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);

  const abs = Math.abs(value);

  switch (format) {
    case "usd":
      // Past five figures the exact cents are noise; the magnitude is the message.
      return abs >= 100_000 ? usdCompact.format(value) : usd.format(value);
    case "percent":
      return `${plain.format(value)}%`;
    case "compact":
      return compact.format(value);
    case "bytes": {
      const units = ["B", "KB", "MB", "GB", "TB", "PB"];
      let v = abs;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${(value < 0 ? -v : v).toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
    }
    case "ms":
    case "duration": {
      if (abs < 1) return `${plain.format(value)} ms`;
      if (abs < 1_000) return `${Math.round(value)} ms`;
      if (abs < 60_000) return `${(value / 1_000).toFixed(2)} s`;
      if (abs < 3_600_000) return `${(value / 60_000).toFixed(1)} min`;
      return `${(value / 3_600_000).toFixed(1)} h`;
    }
    default:
      return abs >= 1_000_000 ? compact.format(value) : plain.format(value);
  }
}

/** Axis ticks need to be shorter than tile values; never show cents on an axis. */
export function formatTick(value: unknown, format: Format = "number"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "");
  switch (format) {
    case "usd": return Math.abs(value) >= 1000 ? usdCompact.format(value) : usd.format(value);
    case "percent": return `${Math.round(value)}%`;
    default: return compact.format(value);
  }
}

/** Date ticks, sized to the bucket so a monthly axis does not print days. */
export function formatTimeTick(value: unknown, granularity: string): string {
  const t = typeof value === "number" ? value : Date.parse(String(value));
  if (Number.isNaN(t)) return String(value ?? "");
  const d = new Date(t);
  switch (granularity) {
    case "hour": return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" });
    case "day":
    case "week": return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    case "month": return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
    case "quarter": return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    case "year": return String(d.getUTCFullYear());
    default: return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
}

/** Percentage change, guarding the divide-by-zero that otherwise renders as Infinity%. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Digit grouping, pinned to en-US.
 *
 * A bare `toLocaleString()` reads the *runtime's* locale, and Node and the
 * browser need not agree — the server rendered "15,02,314" (Indian grouping)
 * while Chrome rendered "1,502,314", which React reports as a hydration
 * mismatch on every number on the page. It lives here beside the other
 * formatters so a value shown on a tile and the same value in a tooltip cannot
 * be grouped differently.
 */
export const n = (v: number) => v.toLocaleString("en-US");
