import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design system's own type scale, registered in `@theme` as `--text-body-*`
 * / `--text-heading-*` / `--text-label*` (see `app/tokens.css`).
 *
 * tailwind-merge has to be told about these. Out of the box it knows `text-xs`
 * is a font size and `text-red-500` is a colour, but `text-body-xs` matches
 * neither pattern, so it guesses *colour* — and then
 * `cn("text-body-xs", "text-role-content-subtle")` treats the two as
 * conflicting and silently drops the size.
 *
 * Keep in sync with the `--text-*` variables in `app/tokens.css`.
 */
const DESIGN_SYSTEM_FONT_SIZES = [
  "label",
  "label-lg",
  "body-xs",
  "body-sm",
  "body-md",
  "body-lg",
  "heading-xs",
  "heading-sm",
  "heading-md",
  "heading-lg",
  "heading-xl",
  "heading-2xl",
  "display-xl",
  "display-2xl",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: DESIGN_SYSTEM_FONT_SIZES }],
    },
  },
});

/** Merges Tailwind classes with the design system's scale understood. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, length: number): string {
  return str.length <= length ? str : `${str.slice(0, length)}...`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}

/**
 * Bytes → a short human size, e.g. `92 KB`, `7.1 MB`. One decimal only below 10
 * in each unit, so a column of sizes stays narrow and scannable.
 */
export function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function asDate(date: Date | string | number): Date {
  return date instanceof Date ? date : new Date(date);
}

/** "2 hours ago" — the phrasing the file rows in Spotlight use. */
export function formatRelativeTime(date: Date | string | number, now = Date.now()): string {
  const diff = now - asDate(date).getTime();
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} ${pluralize(m, "minute")} ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} ${pluralize(h, "hour")} ago`;
  }
  const d = Math.floor(diff / DAY);
  if (d < 7) return `${d} ${pluralize(d, "day")} ago`;
  if (d < 30) {
    const w = Math.floor(d / 7);
    return `${w} ${pluralize(w, "week")} ago`;
  }
  const mo = Math.floor(d / 30);
  return `${mo} ${pluralize(mo, "month")} ago`;
}

/** "2m ago", "3h ago", "5d ago" — for dense rows where the long form wraps. */
export function formatCompactRelativeTime(
  date: Date | string | number,
  now = Date.now(),
): string {
  const diff = now - asDate(date).getTime();
  if (diff < MINUTE) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  const d = Math.floor(diff / DAY);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return asDate(date).toLocaleDateString();
}

/** `HH:MM:SS`, the stamp on every kernel-trace row. */
export function traceTime(date: Date | string | number = new Date()): string {
  return asDate(date).toLocaleTimeString("en-US", { hour12: false });
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}
