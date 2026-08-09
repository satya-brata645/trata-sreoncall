"use client";

import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/primitives";
import {
  useOsWindowChromeSlot,
  useOsWindowChromeTrailingSlot,
} from "@/components/os/OsWindow";
import type { LucideIcon } from "lucide-react";

/**
 * An app's controls, in the window's title bar rather than in its body.
 *
 * The window already owns a 40px band across the top; an app that renders its
 * own tab row underneath spends a second band on the same job and leaves the
 * first one holding nothing but a title. Worse, the two rows then disagree about
 * where the app begins.
 *
 * `OsWindow` exposes the band as two portal targets. These helpers wrap them so
 * every app lands its chrome the same way, and so the `data-os-window-no-drag`
 * marker is never forgotten — without it, typing in a title-bar search field
 * starts dragging the window.
 */

/**
 * The leading box: exactly as wide as the app's sidebar, with the same right
 * border, so the title bar and the sidebar read as one unbroken vertical line
 * down the window instead of two panels that happen to be adjacent.
 *
 * The width comes from the app, and the app's sidebar must read the same const —
 * a literal in each place drifts the moment one is tuned.
 */
export function ChromeLeading({
  width,
  children,
}: {
  width: number;
  children: React.ReactNode;
}) {
  const slot = useOsWindowChromeSlot();
  if (!slot) return null;

  return createPortal(
    <div
      data-os-window-no-drag
      style={{ width }}
      className="flex h-full shrink-0 items-center gap-2.5 border-r border-role-border-subtle pl-3.5"
    >
      {children}
    </div>,
    slot,
  );
}

/** The trailing box: the app's own controls, kept left of the window controls. */
export function ChromeTrailing({ children }: { children: React.ReactNode }) {
  const slot = useOsWindowChromeTrailingSlot();
  if (!slot) return null;

  return createPortal(
    <div data-os-window-no-drag className="flex shrink-0 items-center gap-2">
      {children}
    </div>,
    slot,
  );
}

export interface Panel<Id extends string> {
  id: Id;
  label: string;
  icon?: LucideIcon;
  /** A count worth showing beside the label, e.g. Activity's unread. */
  badge?: number;
  /**
   * Why this panel cannot be opened right now. Present means disabled — and the
   * reason is shown rather than the control silently doing nothing, because a
   * dead tab teaches nothing about what would make it live.
   */
  unavailableBecause?: string;
}

/**
 * The panel switcher.
 *
 * A segmented control rather than tabs: tabs imply documents you collect, and
 * these are views of one thing. Selection is a surface step, never a colour —
 * colour in this system means severity or liveness, and "which view am I on" is
 * neither.
 */
export function PanelSwitcher<Id extends string>({
  panels,
  active,
  onSelect,
}: {
  panels: readonly Panel<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <div role="tablist" aria-orientation="horizontal" className="flex items-center gap-0.5">
      {panels.map((panel) => {
        const disabled = !!panel.unavailableBecause;
        return (
          <button
            key={panel.id}
            type="button"
            role="tab"
            aria-selected={panel.id === active}
            disabled={disabled}
            title={panel.unavailableBecause}
            onClick={() => onSelect(panel.id)}
            className={cn(
              "flex h-[26px] items-center gap-1.5 rounded-2xs px-2.5 text-body-sm transition-colors",
              disabled
                ? "cursor-default text-role-foreground-disabled"
                : panel.id === active
                  ? "bg-role-surface-component-selected text-role-content-heading"
                  : "text-role-content-subtle hover:bg-role-surface-component-hover hover:text-role-content-body",
            )}
          >
            {panel.icon && <Icon icon={panel.icon} size={13} />}
            {panel.label}
            {panel.badge !== undefined && panel.badge > 0 && (
              <span className="ml-0.5 rounded-[5px] bg-role-surface-action px-[5px] text-label-lg font-medium tracking-normal text-role-foreground-on-inverse">
                {panel.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
