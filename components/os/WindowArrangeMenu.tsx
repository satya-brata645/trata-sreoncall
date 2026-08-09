"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import type { OsSnapPreset } from "@/lib/os/geometry";

/**
 * A miniature diagram of which region of the desktop a preset fills.
 *
 * Drawn from the preset's own fractions rather than hand-built per option, so a
 * new arrangement gets a correct glyph for free and the picture can never
 * disagree with the behaviour.
 */
function PresetGlyph({
  fill,
  active,
}: {
  fill: readonly [number, number, number, number];
  active: boolean;
}) {
  const [fx, fy, fw, fh] = fill;
  return (
    <span
      aria-hidden
      className={cn(
        "relative block h-5 w-7 shrink-0 overflow-hidden rounded-2xs border",
        active
          ? "border-role-border-active bg-role-surface-component-selected"
          : "border-role-border-subtle bg-role-surface-component",
      )}
    >
      <span
        className={cn(
          "absolute rounded-[1px]",
          active ? "bg-role-surface-action" : "bg-role-icon-muted",
        )}
        style={{
          left: `${fx * 100}%`,
          top: `${fy * 100}%`,
          width: `${fw * 100}%`,
          height: `${fh * 100}%`,
        }}
      />
    </span>
  );
}

interface PresetOption {
  preset: OsSnapPreset;
  label: string;
  fill: readonly [number, number, number, number];
}

/**
 * Menu contents, declared as data. Groups and their order mirror the platform
 * convention users already know: directional halves first, then whole-desktop
 * and quadrant arrangements.
 */
const GROUPS: ReadonlyArray<{ heading: string; options: readonly PresetOption[] }> = [
  {
    heading: "Move & Resize",
    options: [
      { preset: "left-half", label: "Left", fill: [0, 0, 0.5, 1] },
      { preset: "right-half", label: "Right", fill: [0.5, 0, 0.5, 1] },
      { preset: "top-half", label: "Top", fill: [0, 0, 1, 0.5] },
      { preset: "bottom-half", label: "Bottom", fill: [0, 0.5, 1, 0.5] },
    ],
  },
  {
    heading: "Fill & Arrange",
    options: [
      { preset: "fill", label: "Fill", fill: [0, 0, 1, 1] },
      { preset: "top-left-quarter", label: "Top left", fill: [0, 0, 0.5, 0.5] },
      { preset: "top-right-quarter", label: "Top right", fill: [0.5, 0, 0.5, 0.5] },
      { preset: "bottom-left-quarter", label: "Bottom left", fill: [0, 0.5, 0.5, 0.5] },
      { preset: "bottom-right-quarter", label: "Bottom right", fill: [0.5, 0.5, 0.5, 0.5] },
    ],
  },
];

export interface WindowArrangeMenuProps {
  /** Arrangement currently applied, so the active option can be marked. */
  activePreset?: OsSnapPreset;
  onSelect: (preset: OsSnapPreset) => void;
  /** True while the window owns the whole viewport. */
  isFullScreen?: boolean;
  /** Enter or leave full screen. */
  onToggleFullScreen?: () => void;
  /** Trigger element. */
  children: React.ReactNode;
  /** Controlled open state, for opening the same menu from a right-click. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Window arrangement menu — one-click halves, fill and quadrants.
 *
 * Follows the app's existing menu pattern (raw Radix popover + Portal, as in
 * `ThreadActionsMenu`) rather than introducing another menu abstraction. Radix
 * supplies focus management, arrow-key navigation, escape-to-close and
 * click-outside, so keyboard access comes from the primitive.
 *
 * Entirely generic: it takes presets and a callback, and knows nothing about
 * chat or any other app.
 */
export function WindowArrangeMenu({
  activePreset,
  onSelect,
  isFullScreen,
  onToggleFullScreen,
  children,
  open,
  onOpenChange,
}: WindowArrangeMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  /**
   * Hover-to-open, the way platform window menus behave.
   *
   * Radix Popover has no hover mode, so it is added here. The close is delayed
   * because the pointer has to cross a gap between the trigger and the panel —
   * closing immediately on mouseleave would make the menu impossible to reach.
   * Any re-entry cancels the pending close.
   */
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose, setOpen]);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 220);
  }, [cancelClose, setOpen]);

  // A pending timer must not fire after unmount (e.g. the window is closed
  // while the menu is open) — that would set state on a gone component.
  useEffect(() => cancelClose, [cancelClose]);

  return (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        asChild
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        // Keyboard users get the same menu without a pointer.
        onFocus={openNow}
      >
        {children}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="end"
          // Small offset so the pointer can cross from trigger to panel without
          // passing through a dead zone that would trigger the close timer.
          sideOffset={4}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
          // Opening on hover must not steal focus from whatever the user is
          // doing; Radix would otherwise focus the panel on open.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // z above the window layer so the menu is never clipped by a
          // sibling window stacked on top of its owner.
          className={cn(
            "dos-glass-popover z-[60] min-w-[220px] animate-dos-fade rounded-sm p-2xs text-body-sm",
          )}
        >
          {GROUPS.map((group, groupIndex) => (
            <div key={group.heading}>
              {groupIndex > 0 && (
                <div
                  role="separator"
                  className="my-2xs h-px bg-role-border-subtle"
                />
              )}
              <p className="px-xs py-2xs font-medium text-role-content-muted [font-size:var(--body-xs-font-size)]">
                {group.heading}
              </p>
              <div className="flex flex-col gap-3xs">
                {group.options.map((option) => {
                  const active = activePreset === option.preset;
                  return (
                    <button
                      key={option.preset}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        onSelect(option.preset);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex items-center gap-xs rounded-2xs px-xs py-2xs text-left",
                        "transition-colors",
                        "focus-visible:outline-none focus-visible:ring-1",
                        "focus-visible:ring-role-border-focus",
                        active
                          ? "bg-role-surface-component-selected text-role-content-heading"
                          : "text-role-content-body hover:bg-role-surface-component-hover",
                      )}
                    >
                      <PresetGlyph fill={option.fill} active={active} />
                      <span className="truncate">{option.label}</span>
                      {active && (
                        <span className="ml-auto text-role-content-muted [font-size:var(--body-xs-font-size)]">
                          restore
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Full Screen is its own section, not a member of `OsSnapPreset`:
              it is a mode change rather than a tiling arrangement, so keeping
              it out of the preset union stops "is this window snapped?" and
              "is this window full screen?" becoming the same question. */}
          {onToggleFullScreen && (
            <>
              <div
                role="separator"
                className="my-2xs h-px bg-role-border-subtle"
              />
              <button
                type="button"
                aria-pressed={!!isFullScreen}
                onClick={() => {
                  onToggleFullScreen();
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-xs rounded-2xs px-xs py-2xs text-left",
                  "transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1",
                  "focus-visible:ring-role-border-focus",
                  isFullScreen
                    ? "bg-[var(--color-role-surface-action-hover-subtle)] text-role-foreground-accent"
                    : "text-role-content-body hover:bg-role-surface-component-hover",
                )}
              >
                {isFullScreen ? (
                  <Minimize2 className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                ) : (
                  <Maximize2 className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                )}
                <span className="truncate">
                  {isFullScreen ? "Exit Full Screen" : "Full Screen"}
                </span>
              </button>
            </>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
