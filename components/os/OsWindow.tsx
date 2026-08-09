"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { moveRect, resizeRect, type OsRect, type OsResizeEdge } from "@/lib/os/geometry";
import type { OsSnapPreset } from "@/lib/os/geometry";
import { WindowArrangeMenu } from "./WindowArrangeMenu";
import { WindowResizeHandles } from "./WindowResizeHandles";

/**
 * A window control.
 *
 * A 26px rounded square at the icon-button radius rather than the design
 * system's circular `IconButton`: window chrome is the one place the OS draws
 * squares, and the pill's `on-color` foreground — near-black, meant for the
 * white action fill — rendered these invisible against the title bar's dark
 * glass.
 *
 * Close inverts on hover instead of tinting red. Destructive-red here would be
 * the only red on a healthy desktop, and red in this system means a finding.
 */
function WindowControl({
  label,
  onClick,
  danger,
  children,
  ...rest
}: {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-[26px] items-center justify-center rounded-2xs",
        "text-role-icon-muted transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
        danger
          ? "hover:bg-role-surface-action hover:text-role-foreground-on-inverse"
          : "hover:bg-role-surface-component-hover hover:text-role-content-heading",
        "[&_svg]:size-[13px]",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * The window's leading chrome slot: a DOM node at the far left of the title bar,
 * on the same line as the title, that the hosted app may fill.
 *
 * Exposed as an element to portal into rather than as state to set. An app
 * calling `setState` on its host every render would loop; a portal just mounts
 * into a node the window already owns.
 *
 * Apps that ignore it cost nothing — the slot renders an empty, zero-width box
 * and the header looks exactly as it did before.
 */
const OsWindowChromeContext = createContext<HTMLElement | null>(null);

/**
 * The title-bar slot for the current window, or null before it mounts (and in
 * any context outside a window).
 */
export function useOsWindowChromeSlot(): HTMLElement | null {
  return useContext(OsWindowChromeContext);
}

/**
 * The window's trailing chrome slot: the mirror of the leading one, sitting at
 * the right of the title bar just before the window controls.
 *
 * Separate from the leading slot rather than one slot taking two children,
 * because the two ends are laid out differently — the leading box lines up with
 * an app's sidebar, the trailing box hugs the controls — and an app usually
 * fills one without the other.
 */
const OsWindowChromeTrailingContext = createContext<HTMLElement | null>(null);

/** The trailing title-bar slot, or null before it mounts. */
export function useOsWindowChromeTrailingSlot(): HTMLElement | null {
  return useContext(OsWindowChromeTrailingContext);
}

export interface OsWindowProps {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Stacking order. Owned by the window manager. */
  z: number;
  /** True when this is the frontmost window — drives elevation and title emphasis. */
  isFocused: boolean;
  onClose: () => void;
  onMinimize: () => void;
  /** Apply a one-click arrangement. */
  onSnap: (preset: OsSnapPreset) => void;
  /** Arrangement currently applied, if any. */
  snappedTo?: OsSnapPreset;
  /** True while this window owns the whole viewport. */
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  /** Called on pointer-down anywhere in the window, to raise it. */
  onFocus: () => void;
  /** Called during a drag with the window's new rectangle, in desktop-local px. */
  onGeometryChange: (rect: OsRect) => void;
  children: React.ReactNode;
}

/**
 * One live pointer interaction — either moving the window by its title bar, or
 * resizing it from one of its boundaries. Both are the same gesture shape (grab,
 * track deltas, release), so they share a single code path: one state, one
 * listener set, one cleanup.
 */
interface Interaction {
  kind: "move" | "resize";
  /** Which boundary is being dragged. Unused for a move. */
  edge?: OsResizeEdge;
  /** Pointer position when the gesture began. */
  originX: number;
  originY: number;
  /** Window rectangle when the gesture began — deltas apply to this, not to
   *  the live rect, so rounding can't accumulate across a long drag. */
  startRect: OsRect;
}

/**
 * Reusable window chrome. Knows nothing about any specific app — it renders a
 * title bar, resize boundaries, a close control and a body slot, and reports
 * geometry changes upward. Every OS app is hosted in one of these.
 *
 * Pointer handling follows the same discipline as the Activity panel resize in
 * `AuthenticatedLayout`: listeners are attached in an effect keyed on the active
 * interaction so that *every* way a gesture can end — pointerup, pointercancel
 * (touch/pen or pointer-capture loss), or unmounting mid-drag — detaches them
 * and restores the body cursor and `user-select`. A missed restore leaves
 * `user-select: none` on <body>, silently breaking text selection app-wide
 * until a reload.
 */
export function OsWindow({
  title,
  x,
  y,
  width,
  height,
  z,
  isFocused,
  onClose,
  onMinimize,
  onSnap,
  snappedTo,
  isFullScreen,
  onToggleFullScreen,
  onFocus,
  onGeometryChange,
  children,
}: OsWindowProps) {
  const [arrangeOpen, setArrangeOpen] = useState(false);

  // A callback ref in state, not `useRef`: the app portals into this node, and
  // a plain ref's mutation would not re-render to hand the node down.
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null);
  const [trailingSlot, setTrailingSlot] = useState<HTMLElement | null>(null);
  // Read inside stable callbacks without adding a dependency that would
  // recreate them (and re-subscribe listeners) on every toggle.
  const isFullScreenRef = useRef(isFullScreen);
  useEffect(() => {
    isFullScreenRef.current = isFullScreen;
  }, [isFullScreen]);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  // Read inside the move handler without re-subscribing listeners on every
  // parent render. Synced in an effect rather than assigned during render —
  // writing to a ref while rendering is not safe under concurrent rendering.
  const onGeometryChangeRef = useRef(onGeometryChange);
  useEffect(() => {
    onGeometryChangeRef.current = onGeometryChange;
  }, [onGeometryChange]);

  const currentRect = { x, y, width, height };
  // Snapshot the rect into the gesture on pointer-down, so the effect below
  // never needs the live props as dependencies.
  const rectRef = useRef<OsRect>(currentRect);
  useEffect(() => {
    rectRef.current = { x, y, width, height };
  }, [x, y, width, height]);

  const beginMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // A full-screen window owns the viewport; dragging it would only reveal
    // desktop it is supposed to be covering.
    if (isFullScreenRef.current) return;
    // Never start a move from a resize handle or the close button.
    if ((e.target as HTMLElement).closest("[data-os-window-no-drag]")) return;
    e.preventDefault();
    setInteraction({
      kind: "move",
      originX: e.clientX,
      originY: e.clientY,
      startRect: rectRef.current,
    });
  }, []);

  const beginResize = useCallback(
    (edge: OsResizeEdge, e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      // Stop the pointer-down from also reaching the title bar / focus handler
      // paths that sit above these targets.
      e.stopPropagation();
      onFocus();
      setInteraction({
        kind: "resize",
        edge,
        originX: e.clientX,
        originY: e.clientY,
        startRect: rectRef.current,
      });
    },
    [onFocus],
  );

  // Escape leaves full screen. Registered only while full screen so it can't
  // swallow Escape from anything else (a menu, a dialog inside an app).
  useEffect(() => {
    if (!isFullScreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleFullScreen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullScreen, onToggleFullScreen]);

  useEffect(() => {
    if (!interaction) return;

    document.body.style.cursor =
      interaction.kind === "move" ? "grabbing" : "";
    document.body.style.userSelect = "none";

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - interaction.originX;
      const dy = ev.clientY - interaction.originY;
      const bounds = { width: window.innerWidth, height: window.innerHeight };
      const next =
        interaction.kind === "move"
          ? moveRect(interaction.startRect, dx, dy, bounds)
          : resizeRect(interaction.startRect, interaction.edge!, dx, dy, bounds);
      onGeometryChangeRef.current(next);
    };
    const endInteraction = () => setInteraction(null);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endInteraction);
    window.addEventListener("pointercancel", endInteraction);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endInteraction);
      window.removeEventListener("pointercancel", endInteraction);
    };
  }, [interaction]);

  return (
    <section
      aria-label={title}
      onPointerDown={onFocus}
      className={cn(
        "absolute flex animate-dos-fadeup flex-col overflow-hidden",
        // Glass, not chrome: the window is a translucent layer over the
        // desktop, and the grid showing faintly through its body is what keeps
        // it reading as sitting *on* a desktop rather than replacing it.
        "dos-glass-window",
        // Square corners and no elevation in full screen: a rounded, shadowed
        // rectangle would show desktop bleeding through at the screen corners.
        isFullScreen
          ? "rounded-none border-transparent"
          : isFocused
            ? // Focus is carried by the border alone. The whole system reserves
              // colour for meaning, so "this is the window you are in" gets a
              // brighter hairline rather than a tint or a glow.
              "rounded-lg border-role-border-active"
            : "rounded-lg border-role-border-subtle",
      )}
      style={{ left: x, top: y, width, height, zIndex: z }}
    >
      <header
        onPointerDown={beginMove}
        // Right-click anywhere on the title bar opens the arrange menu — the
        // accelerator for people who already know it's there, alongside the
        // visible control.
        onContextMenu={(e) => {
          e.preventDefault();
          setArrangeOpen(true);
        }}
        className={cn(
          "flex h-10 shrink-0 items-center justify-between gap-xs",
          "border-b border-role-border-subtle",
          // A top-lit gradient rather than a flat fill — the title bar is the
          // lip of the glass, and a solid band across it reads as a toolbar
          // bolted on rather than as part of the same pane.
          "bg-gradient-to-b from-[rgba(255,255,255,0.05)] to-[rgba(255,255,255,0.015)]",
          // No left padding: the leading slot sits flush against the window
          // edge so an app's sidebar divider can line up with it. The title
          // carries the padding instead.
          "pr-2xs py-2xs select-none touch-none text-body-sm",
          isFullScreen
            ? "cursor-default"
            : interaction?.kind === "move"
              ? "cursor-grabbing"
              : "cursor-grab",
        )}
      >
        {/* Leading chrome slot. `data-os-window-no-drag` so an app's controls
            here don't also start a window move. Empty and zero-width unless the
            app portals into it. */}
        <div
          ref={setChromeSlot}
          data-os-window-no-drag
          className="flex shrink-0 items-center self-stretch"
        />
        <h2
          className={cn(
            // `pl-xs`, not `pl-md`: the header's own `gap-xs` already sits
            // between the leading slot and this title, so 8 + 8 lands the text
            // at the same 16px it had before the slot existed.
            "flex-1 truncate pl-xs text-heading-xs font-semibold",
            isFocused ? "text-role-content-heading" : "text-role-content-subtle",
          )}
        >
          {title}
        </h2>
        {/* Trailing chrome slot — an app's own title-bar controls, kept left of
            the window controls so Close stays rightmost. Empty and zero-width
            unless the app portals into it. */}
        <div
          ref={setTrailingSlot}
          data-os-window-no-drag
          className="flex shrink-0 items-center gap-xs"
        />
        {/* Control cluster. `data-os-window-no-drag` keeps a click on any of
            these from also starting a window move. Close stays rightmost. */}
        <div className="flex shrink-0 items-center gap-[3px]" data-os-window-no-drag>
          <WindowArrangeMenu
            activePreset={snappedTo}
            onSelect={onSnap}
            isFullScreen={isFullScreen}
            onToggleFullScreen={onToggleFullScreen}
            open={arrangeOpen}
            onOpenChange={setArrangeOpen}
          >
            <WindowControl
              label={isFullScreen ? `Exit full screen ${title}` : `Full screen ${title}`}
              aria-haspopup="dialog"
              aria-expanded={arrangeOpen}
              onClick={onToggleFullScreen}
            >
              {isFullScreen ? <Minimize2 strokeWidth={1.5} /> : <Maximize2 strokeWidth={1.5} />}
            </WindowControl>
          </WindowArrangeMenu>
          <WindowControl label={`Minimize ${title}`} onClick={onMinimize}>
            <Minus strokeWidth={1.5} />
          </WindowControl>
          <WindowControl label={`Close ${title}`} onClick={onClose} danger>
            <X strokeWidth={1.5} />
          </WindowControl>
        </div>
      </header>

      {/*
        `min-h-0` so a flex child that renders `h-full` (chat does) is bounded by
        the window instead of growing past it.

        `isolate` is load-bearing, not decoration. Without it, an app's own
        stacking wins against the window's resize handles: chat's composer is
        `sticky bottom-0 z-50`, which as a sibling of the z-10 handles covered
        the entire bottom edge, both bottom corners, and the lower fifth of the
        left and right edges — those boundaries were simply not grabbable.
        `isolation: isolate` opens a new stacking context, so *any* z-index an
        app uses internally is contained and can never outrank window chrome.
        This is why it's fixed here rather than by bidding the handles' z-index
        higher than whatever an app happens to use.
      */}
      <div className="isolate min-h-0 flex-1 overflow-hidden">
        <OsWindowChromeContext.Provider value={chromeSlot}>
          <OsWindowChromeTrailingContext.Provider value={trailingSlot}>
            {children}
          </OsWindowChromeTrailingContext.Provider>
        </OsWindowChromeContext.Provider>
      </div>

      {/* While resizing, the app's own iframes/canvases must not swallow the
          pointer — this overlay keeps every move event on the window. */}
      {interaction?.kind === "resize" && (
        <div className="absolute inset-0 z-20" aria-hidden />
      )}

      {/* No resize boundaries in full screen — there is nothing to resize to. */}
      {!isFullScreen && (
        <WindowResizeHandles title={title} onResizeStart={beginResize} />
      )}
    </section>
  );
}
