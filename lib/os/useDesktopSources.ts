"use client";

/**
 * The live sources `buildDesktopSnapshot` needs.
 *
 * Deliberately the only module in the reading path that touches React, the
 * registry or the network. `desktopState.ts` stays pure so the whole snapshot
 * shape is testable in `node --test`; this file does the wiring that cannot be.
 */

import { useMemo } from "react";

import {
  buildAppCatalog,
  OS_APP_AGENT_DESCRIPTIONS,
  type DesktopSnapshotInput,
  type OsAppDescriptor,
} from "./desktopState";
import { OS_APPS } from "./registry";
import { usePinnedApps } from "./pinnedApps";
import { useWindowManager } from "./WindowManagerContext";
import { useAppStoreCatalog } from "@/lib/hooks/useAppStore";

/**
 * The OS's own dockable apps, paired with the descriptions that tell the agent
 * when to open them.
 *
 * Filtered by `showInDock` for the same reason the dock filters: the shared
 * security-app entry is not a thing you launch, it is the host a project opens
 * into, so offering it to the agent would be offering a verb with no meaning.
 */
export function osAppDescriptors(): OsAppDescriptor[] {
  return OS_APPS.filter((app) => app.showInDock !== false).map((app) => ({
    appId: app.id,
    title: app.title,
    description: OS_APP_AGENT_DESCRIPTIONS[app.id],
    panels: app.panels,
    affordances: app.affordances,
  }));
}

/** Everything the snapshot needs except the per-call and per-run bits. */
export type LiveDesktopSources = Omit<
  DesktopSnapshotInput,
  "previous" | "viewport" | "mode"
>;

/**
 * Gather the live sources.
 *
 * Viewport and mode are deliberately absent. Viewport is read at call time
 * (`readViewport`) because measuring it during render is a hydration hazard and
 * every caller is in an event handler; mode is owned by the mode store and is
 * only authoritative once the server has clamped it.
 */
export function useDesktopSources(): LiveDesktopSources {
  const { windows, focusedWindowId } = useWindowManager();
  const { pinned } = usePinnedApps();
  // The same query the App Store uses, so the two can never disagree about
  // what exists. Org-aware and cached by that hook.
  const { data } = useAppStoreCatalog();

  const osApps = useMemo(() => osAppDescriptors(), []);
  const catalog = useMemo(
    () => buildAppCatalog(osApps, data?.apps),
    [osApps, data?.apps],
  );

  return { windows, focusedWindowId, pinned, osApps, catalog };
}

/**
 * The viewport, read at call time.
 *
 * Safe from an event handler; returns zeroes during SSR rather than throwing,
 * so a snapshot built on the server is degraded but never fatal.
 */
export function readViewport(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}
