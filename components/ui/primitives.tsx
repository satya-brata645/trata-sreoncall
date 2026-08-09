"use client";

import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The building blocks every app window is assembled from.
 *
 * They exist so density and the white-alpha ladder are decided once. An app
 * body that reaches for raw padding and a raw `rgba(255,255,255,…)` will drift
 * within a release; one that reaches for `Row` and `SectionLabel` cannot.
 */

/**
 * Every icon in the OS goes through here.
 *
 * `strokeWidth: 1.5` is the command-palette weight the whole system is drawn
 * at, and it is the single easiest thing to lose: a Lucide icon dropped in
 * directly renders at 2 and reads noticeably heavier beside its neighbours.
 * Centralising it means the drift cannot happen one component at a time.
 */
export function Icon({
  icon: Glyph,
  size = 15,
  className,
  ...rest
}: { icon: ComponentType<LucideProps>; size?: number } & Omit<LucideProps, "ref" | "size">) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.5}
      absoluteStrokeWidth
      className={cn("shrink-0", className)}
      aria-hidden
      {...rest}
    />
  );
}

/** `RECENT`, `FILES`, `KERNEL TRACE` — with the count the screenshot puts beside it. */
export function SectionLabel({
  children,
  count,
  className,
}: {
  children: ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 px-sm py-xs", className)}>
      <span className="dos-label">{children}</span>
      {count !== undefined && (
        <span className="rounded-[5px] bg-role-surface-component px-[5px] py-[1px] text-label-lg font-medium tracking-normal text-role-content-subtle">
          {count}
        </span>
      )}
    </div>
  );
}

/** A keyboard hint. Always on the elevated ground, never on glass. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="dos-kbd font-sans">{children}</kbd>;
}

/**
 * A list row.
 *
 * Selection is a *stronger surface*, not a colour — the whole system reserves
 * colour for meaning, so "this is the one you are on" has to be carried by the
 * ladder.
 */
export function Row({
  children,
  selected,
  onClick,
  className,
  ...rest
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onClick" | "children">) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "flex items-center gap-sm rounded-sm px-sm py-2 transition-colors",
        onClick && "cursor-pointer hover:bg-role-surface-component-hover",
        selected && "bg-role-surface-component-selected",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A square tile for an icon — dock items, quick actions, file kinds. */
export function Tile({
  children,
  size = 30,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xs bg-role-surface-component text-role-icon-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A status dot.
 *
 * Violet pulses because it means *live*; everything else is still, because a
 * pulsing red would read as an alarm going off rather than a severity.
 */
export function StatusDot({
  tone = "live",
  className,
}: {
  tone?: "live" | "critical" | "high" | "medium" | "low" | "idle";
  className?: string;
}) {
  const color =
    tone === "critical"
      ? "var(--color-role-status-critical-default)"
      : tone === "high"
        ? "var(--color-role-status-high-default)"
        : tone === "medium"
          ? "var(--color-role-status-medium-default)"
          : tone === "low" || tone === "live"
            ? "var(--dos-violet)"
            : "var(--color-role-icon-subtle)";
  return (
    <span
      style={{ background: color }}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "live" && "animate-dos-pulse",
        className,
      )}
    />
  );
}

/**
 * Nothing here, and why.
 *
 * Dashed rather than filled: an empty state is an affordance, and the dashed
 * outline is the system's way of saying "something goes here" without drawing
 * a box that looks like content.
 */
export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ComponentType<LucideProps>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-md py-2xl text-center">
      <span className="flex size-[60px] items-center justify-center rounded-lg border border-dashed border-role-border-strong bg-role-surface-component-subtle text-role-content-subtle">
        {icon ? <Icon icon={icon} size={20} /> : <span className="text-heading-lg font-light">+</span>}
      </span>
      <div className="flex flex-col items-center gap-1">
        <p className="dos-label text-role-content-subtle">{title}</p>
        {hint && <p className="dos-label text-role-content-muted">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * The freshness stamp §4 of the concept note calls mandatory.
 *
 * No-runs promises always-live, so every app has to say *as of when*. The
 * moment that promise breaks silently, someone is making a security decision on
 * stale data — which is why this is a component rather than a convention.
 */
export function AsOf({ when, className }: { when: string; className?: string }) {
  return (
    <span className={cn("dos-label", className)} title={new Date(when).toLocaleString()}>
      As of {when}
    </span>
  );
}

/** A pill filter chip, as the Spotlight type row uses. */
export function Chip({
  children,
  icon,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode;
  icon?: ComponentType<LucideProps>;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-body-sm transition-colors",
        disabled
          ? "cursor-default border-role-border-disabled text-role-foreground-disabled"
          : active
            ? "border-role-border-focus bg-role-surface-component-selected text-role-content-heading"
            : "border-role-border-subtle bg-role-surface-container-subtle text-role-content-body hover:bg-role-surface-component-hover",
      )}
    >
      {icon && <Icon icon={icon} size={13} className={disabled ? "opacity-60" : undefined} />}
      {children}
    </button>
  );
}
