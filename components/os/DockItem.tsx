"use client";

import { useState, type ComponentType } from "react";
import { Check, type LucideIcon } from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
// Imported from the concrete files rather than the `@/components/ui` barrel:
// the barrel re-exports PdfViewer, which evaluates `new DOMMatrix()` at module
// load and throws during SSR. Matches how the rest of the app imports these.
import { IconButton } from "@/components/ui/icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { OS_DOCK_Z } from "@/lib/os/constants";
import type { AppArtworkProps } from "@/components/os/icons/AppArtwork";

/** One of this app's open windows, as listed in the dock menu. */
export interface DockMenuWindow {
  id: string;
  title: string;
  /** True for the frontmost window — the one that gets the tick. */
  isActive: boolean;
}

/**
 * The dock's right-click menu, modelled on the macOS one: the app's open
 * windows at the top with a tick against the current one, then the actions.
 */
export interface DockItemMenu {
  windows: DockMenuWindow[];
  onSelectWindow: (windowId: string) => void;
  /**
   * Open an additional window. Omitted for singletons, where a second window
   * is deliberately impossible — so the item is absent rather than present and
   * silently doing nothing.
   */
  onNewWindow?: () => void;
  /** Keep in / Remove from Dock. Omitted for the OS's own permanent apps. */
  pinAction?: { label: string; onSelect: () => void };
}

/** Divider between the menu's sections. */
function MenuSeparator() {
  return (
    <div
      role="separator"
      className="my-2xs h-px w-full bg-role-border-subtle"
    />
  );
}

/**
 * One row of the dock menu.
 *
 * The tick lives in a fixed-width gutter that is present whether or not the row
 * is checked, so labels line up down the menu instead of shifting by the width
 * of a checkmark — the same alignment macOS uses.
 */
function MenuRow({
  checked,
  onSelect,
  children,
}: {
  checked?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2xs rounded-2xs px-2xs py-2xs text-left",
        "text-role-content-body transition-colors",
        "hover:bg-[var(--color-role-surface-action-hover-subtle)]",
        "focus-visible:outline-none focus-visible:ring-1",
        "focus-visible:ring-role-border-focus",
      )}
    >
      <span aria-hidden className="flex w-4 shrink-0 justify-center">
        {checked && <Check className="size-3.5" strokeWidth={1.5} />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

export interface DockItemProps {
  title: string;
  /**
   * The app's stroke symbol. Only drawn when the app has no `artwork` yet — a
   * new registry entry is reachable from the dock before anyone has drawn it
   * an icon.
   */
  icon: LucideIcon;
  /**
   * The app's icon: a drawn, coloured tile that fills the launcher.
   *
   * The dock is the one place in this system where every app is a *thing you
   * point at* rather than a thing being described, which is why colour lives
   * here and nowhere inside a window. It is also the whole reason the tiles are
   * legible at a glance: five identical grey squares differing only by a stroke
   * glyph are five things you have to read.
   */
  artwork?: ComponentType<AppArtworkProps>;
  /** True when the app has at least one open window. */
  isOpen: boolean;
  onSelect: () => void;
  /** The app's hue, for the stroke fallback. Ignored when `artwork` is set. */
  tint?: string;
  /** Right-click menu for this tile. Omitted → no context menu at all. */
  menu?: DockItemMenu;
}

/**
 * A single launcher in the dock: a rounded-square app tile that magnifies on
 * hover, a hover label, and a running indicator when the app has a window open.
 *
 * Built on `IconButton` so the tile inherits the design system's focus ring,
 * hit area and disabled handling. Its base shape is a circular pill, so the
 * radius, colours and scale are overridden here — a dock tile is a square by
 * convention, and `cn`/tailwind-merge resolves the `rounded-*` conflict cleanly.
 */
export function DockItem({
  title,
  icon: Icon,
  artwork: Artwork,
  isOpen,
  onSelect,
  menu,
  tint,
}: DockItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // A closed singleton has no windows to list, no New Window and no pin — every
  // section empty. Rendering that opens a blank box, so the tile gets no
  // context menu at all in that state rather than an empty one.
  const hasMenu =
    !!menu &&
    (menu.windows.length > 0 || !!menu.onNewWindow || !!menu.pinAction);

  return (
    // Root renders no DOM of its own, so it is always present rather than
    // branched on `menu` — one tree, no duplicated tile markup.
    <PopoverPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Anchor must land on the tile's own DOM node. Wrapping the Tooltip
              instead gives Radix a component with no element to measure, and
              the menu is positioned off-screen. Chained `asChild` composes both
              refs onto the div below. */}
          <PopoverPrimitive.Anchor asChild>
            <div
              className="relative flex items-center"
              onContextMenu={
                hasMenu
                  ? (e) => {
                      // Replace the browser menu, not sit behind it.
                      e.preventDefault();
                      setMenuOpen(true);
                    }
                  : undefined
              }
            >
              <IconButton
                variant="transparent"
                size="md"
                aria-label={title}
                aria-pressed={isOpen}
                onClick={onSelect}
                className={cn(
                  // A 44px rounded square at the dock radius, so the tiles read
                  // as app icons sitting on the frosted rail rather than as bare
                  // buttons cut into it.
                  "size-11 rounded-[11px]",
                  // Magnification, kept gentle. `origin-left` grows the tile
                  // away from the screen edge instead of pushing it off-screen,
                  // and a transform-only transition keeps it cheap — no layout
                  // work, so neighbours don't shift as it grows.
                  "origin-left transition-transform duration-150 ease-out",
                  "hover:scale-[1.09] active:scale-[1.01]",
                  Artwork
                    ? cn(
                        // The icon *is* the tile. No padding, no button surface
                        // and no hover fill behind it: a chip drawn around a
                        // drawn icon is the thing that makes a web dock look
                        // like a toolbar. `size-full` beats IconButton's own
                        // `[&_svg]:size-5`, which would shrink the art to a
                        // glyph.
                        "p-0 [&_svg]:size-full",
                        "bg-transparent hover:bg-transparent",
                        // Contact shadow — what separates a tile from the frost
                        // it sits on, and the only thing making the icons read
                        // as objects on the rail rather than printed into it.
                        "drop-shadow-[0_2px_5px_rgba(0,0,0,0.45)]",
                      )
                    : cn(
                        "border border-role-border-subtle bg-role-surface-component-subtle",
                        "hover:bg-role-surface-component-selected",
                        !tint && "text-role-icon",
                      ),
                )}
                style={!Artwork && tint ? { color: tint } : undefined}
              >
                {Artwork ? (
                  <Artwork size={44} />
                ) : (
                  <Icon size={17} strokeWidth={1.5} absoluteStrokeWidth />
                )}
              </IconButton>
              {/* Running indicator — the dock's only state, and white rather
              than violet: the accent means *the agent is working*, and a dock
              full of violet would drain that of meaning. `pointer-events-none`
              so it never intercepts a click meant for the button. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -left-[7px] top-1/2 h-3.5 w-[3px]",
                  "-translate-y-1/2 rounded-full transition-opacity",
                  isOpen ? "bg-role-surface-action opacity-100" : "opacity-0",
                )}
              />
            </div>
          </PopoverPrimitive.Anchor>
        </TooltipTrigger>
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>

      {hasMenu && menu && (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="right"
            align="center"
            sideOffset={8}
            // Portalled to the body, so it needs to clear the dock explicitly —
            // the rail itself sits at OS_DOCK_Z.
            style={{ zIndex: OS_DOCK_Z + 1 }}
            className={cn(
              "dos-glass-popover min-w-[200px] rounded-sm p-2xs",
              "animate-dos-fade text-body-sm",
            )}
          >
            {/* Open windows, ticked like the macOS dock menu. */}
            {menu.windows.map((w) => (
              <MenuRow
                key={w.id}
                checked={w.isActive}
                onSelect={() => {
                  menu.onSelectWindow(w.id);
                  setMenuOpen(false);
                }}
              >
                {w.title}
              </MenuRow>
            ))}

            {menu.windows.length > 0 &&
              (menu.onNewWindow || menu.pinAction) && <MenuSeparator />}

            {menu.onNewWindow && (
              <MenuRow
                onSelect={() => {
                  menu.onNewWindow?.();
                  setMenuOpen(false);
                }}
              >
                New Window
              </MenuRow>
            )}

            {menu.onNewWindow && menu.pinAction && <MenuSeparator />}

            {menu.pinAction && (
              <MenuRow
                onSelect={() => {
                  menu.pinAction?.onSelect();
                  setMenuOpen(false);
                }}
              >
                {menu.pinAction.label}
              </MenuRow>
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      )}
    </PopoverPrimitive.Root>
  );
}
