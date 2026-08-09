import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { AppArtworkProps } from "@/components/os/icons/AppArtwork";
import type { OsRect, OsSnapPreset } from "./geometry";

/**
 * Identifier for an OS app. Kept as a plain string rather than a closed union
 * so the registry stays the single source of truth — adding an app means
 * editing `lib/os/registry.tsx` and nothing else.
 */
export type OsAppId = string;

/** Props every windowed app receives from the window layer. */
export interface OsAppProps {
  /** Id of the window hosting this app instance. */
  windowId: string;
  /** Close the hosting window. Apps use this for their own "done" affordances. */
  onRequestClose: () => void;
  /**
   * Arbitrary values the opener attached to this window — e.g. which security
   * app a detail window is showing. Lets one registry entry serve many
   * instances without the window manager knowing what any of them mean.
   */
  params?: Record<string, string>;
  /**
   * Update this window's params.
   *
   * Params are the app's **address**, not merely its opening arguments. An app
   * that keeps its current view in `useState` is a room with no door number:
   * the agent can open it but cannot say "the memory panel". Deriving the view
   * from params and calling this to change it makes the inside of an app
   * addressable by exactly the same mechanism as the outside.
   *
   * Merged, not replaced, so one control need not know every key another part
   * of the app set.
   */
  setParams: (params: Record<string, string>) => void;
}

/**
 * A registered OS app. This is the whole contract for appearing in the dock and
 * opening in a window — no app-specific branching exists anywhere else.
 */
export interface OsAppDefinition {
  id: OsAppId;
  /** Shown in the window title bar and the dock tooltip. */
  title: string;
  /**
   * The app's stroke symbol, for dense or textual contexts — a menu row, a
   * window's chrome, a line of prose. Never a launcher: those show `artwork`.
   */
  icon: LucideIcon;
  /**
   * The app's icon — a drawn, coloured tile, shown wherever the app is being
   * *launched* rather than merely referred to.
   *
   * Optional so a new app is a working entry the moment its component exists;
   * the dock falls back to the stroke symbol until someone draws one. That is
   * the honest order — an app with no icon yet is not an app that should be
   * unreachable.
   */
  artwork?: ComponentType<AppArtworkProps>;
  /** Rendered inside the window body. */
  component: ComponentType<OsAppProps>;
  /**
   * Whether the app gets a dock launcher. False for apps that are only opened
   * from inside another app (a per-project detail window, say) — they are real
   * windowed apps, just not things you launch cold.
   */
  showInDock?: boolean;
  /**
   * When true, launching an already-open app focuses its existing window
   * instead of opening a second one. Chat is a singleton — it keeps its own
   * thread list internally, so a second chat window would be redundant.
   */
  singleton?: boolean;
  /**
   * The parts of this app the agent can be asked to bring up.
   *
   * Declared here rather than registered at mount so the snapshot builder stays
   * pure — it can say what a window *can* show without the window having
   * rendered. An app with no entry simply cannot be addressed inside, which is
   * the honest default: nothing claims a capability it has not implemented.
   */
  panels?: readonly OsAppPanel[];
  /**
   * The controls inside this app the agent may set.
   *
   * Panels answer *which view*; affordances answer *which of the things in
   * it*. Declared here for the same reason panels are, and it is the reason
   * `os-agent-control.md` §12.1 chose declaration over harvesting the DOM:
   * a declared control's class is statically knowable, so `D3` — does this
   * change which things exist? — still has an answer before the step runs. A
   * harvested element cannot answer it, and every abort layer rests on it.
   */
  affordances?: readonly OsAppAffordance[];
}

/**
 * One control inside an app the agent can set.
 *
 * **Setting, never submitting.** Every affordance narrows or moves what is on
 * screen; none of them commit anything. That is doctrine rule `dont-submit`
 * made structural rather than merely stated — there is no shape here that can
 * express "press send", so an agent cannot reach for one.
 */
export interface OsAppAffordance {
  /** Stable id. Written into `params` under this key. */
  id: string;
  /** What the agent calls it out loud. */
  label: string;
  /**
   * What kind of control it is.
   *
   * - `search` — free text narrowing a list.
   * - `filter` — a named subset, from `options`.
   * - `select` — bring one specific item into view.
   */
  kind: "search" | "filter" | "select";
  /** For `filter`: the values it accepts. Absent means free-form. */
  options?: readonly string[];
  /** When to reach for it. Reaches the model, so it earns its place. */
  description?: string;
}

/** One addressable view inside an app. */
export interface OsAppPanel {
  /** Stable id. Written into `params.panel`. */
  id: string;
  /** What the agent calls it out loud. */
  label: string;
  /** When to bring it up. Reaches the model, so it earns its place. */
  description?: string;
}

/** A live window on the desktop. Geometry is px, in desktop-local coordinates. */
export interface OsWindowInstance {
  id: string;
  appId: OsAppId;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Stacking order; highest is frontmost. */
  z: number;
  /** Values the opener attached to this instance. See `OsAppProps.params`. */
  params?: Record<string, string>;
  /** Per-instance title, overriding the registry's. */
  title?: string;
  /**
   * Hidden from the desktop but still alive. Minimized windows stay in state
   * and stay mounted, so an app's in-flight work (a streaming chat response, a
   * live voice session) survives being put away.
   */
  isMinimized: boolean;
  /**
   * Rectangle to return to when un-snapping. Set when a window is snapped from
   * a free-floating state; cleared once restored.
   */
  restoreRect?: OsRect;
  /** Currently applied arrangement, if any. */
  snappedTo?: OsSnapPreset;
  /**
   * Full-screen takeover: the window covers the entire viewport and the dock
   * hides. Deliberately separate from the snap system rather than another
   * `OsSnapPreset` — a snapped window that goes full screen and comes back
   * should land in its snapped rect, which needs its own restore slot.
   */
  isFullScreen: boolean;
  /** Rectangle to return to when leaving full screen. */
  preFullScreenRect?: OsRect;
}
