/**
 * Turning the live desktop into the snapshot the agent reads.
 *
 * Everything here is **pure**: no React, no DOM, no registry. The OS's own app
 * list arrives as an argument rather than being imported, because the registry
 * couples app metadata to app *components* — importing it here would drag the
 * entire component tree into a module whose whole value is being testable
 * without a browser. `useDesktopSources` does the wiring.
 *
 * See `agentProtocol.ts` for the shape, and for why handles are creation-ordered
 * and the epoch is a signature.
 */

import {
  allocateHandles,
  computeEpoch,
  markDiff,
  type AppCatalogEntry,
  type DesktopSnapshot,
  type DockEntryView,
  type DockView,
  type OsAgentMode,
  type AffordanceView,
  type PanelView,
  type WindowView,
} from "./agentProtocol";
import type { OsWindowInstance } from "./types";
import type { PinnedApp } from "./pinnedApps";
import { formatProjectName } from "@/lib/utils/copy-glossary";
import type { Project } from "@/lib/api/types";

/** One of the OS's own apps, as the snapshot builder needs it. */
export interface OsAppDescriptor {
  appId: string;
  title: string;
  /** Why the agent would open it. See `OS_APP_AGENT_DESCRIPTIONS`. */
  description?: string;
  /** The parts of it the agent can ask for. Absent when it has none. */
  panels?: readonly PanelView[];
  /** The controls inside it the agent may set. Absent when it has none. */
  affordances?: readonly AffordanceView[];
}

/**
 * The app id the agent uses for a window.
 *
 * Every security app shares one registry id and carries its project in
 * `params.appId`. The agent thinks in projects — "Pentest", not "security-app" —
 * so the project wins where there is one. That also keeps the id on a window
 * matching the id in the catalogue, which is what makes "open what's in [2]
 * again" resolvable.
 */
export function effectiveAppId(window: OsWindowInstance): string {
  return window.params?.appId ?? window.appId;
}

/**
 * Is this window a security app rather than one of the OS's own?
 *
 * Derived from the presence of a project param rather than from comparing
 * against the shared registry id — same answer, and it keeps this module free
 * of the registry.
 */
function isSecurityAppWindow(window: OsWindowInstance): boolean {
  return typeof window.params?.appId === "string";
}

function windowTitle(
  window: OsWindowInstance,
  osApps: readonly OsAppDescriptor[],
): string {
  if (window.title) return window.title;
  const app = osApps.find((candidate) => candidate.appId === window.appId);
  return app?.title ?? window.appId;
}

export interface DesktopSnapshotInput {
  windows: readonly OsWindowInstance[];
  focusedWindowId: string | null;
  pinned: readonly PinnedApp[];
  /** The OS's own dockable apps, in dock order. */
  osApps: readonly OsAppDescriptor[];
  /** Apps the workspace can actually open. Locked apps are deliberately absent. */
  catalog: readonly AppCatalogEntry[];
  viewport: { width: number; height: number };
  mode: OsAgentMode;
  /** The previous snapshot's windows, for diff marking. Null on the first read. */
  previous: readonly WindowView[] | null;
}

/**
 * Count open windows per app.
 *
 * A minimized window counts: it is open, it is exactly what a dock entry exists
 * to get you back to, and saying otherwise would have the agent open a second
 * copy of something already there.
 */
function countWindowsByApp(
  windows: readonly OsWindowInstance[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const window of windows) {
    const appId = effectiveAppId(window);
    counts.set(appId, (counts.get(appId) ?? 0) + 1);
  }
  return counts;
}

function buildDock(
  windows: readonly OsWindowInstance[],
  pinned: readonly PinnedApp[],
  osApps: readonly OsAppDescriptor[],
): DockView {
  const counts = countWindowsByApp(windows);

  const system: DockEntryView[] = osApps.map((app) => ({
    appId: app.appId,
    name: app.title,
    openWindows: counts.get(app.appId) ?? 0,
  }));

  const pinnedIds = new Set(pinned.map((app) => app.id));
  const pinnedEntries: DockEntryView[] = pinned.map((app) => ({
    appId: app.id,
    name: formatProjectName(app.name),
    openWindows: counts.get(app.id) ?? 0,
  }));

  // Running-but-not-kept, deduped by project — the transient third group, the
  // same split the dock itself draws.
  const running = new Map<string, DockEntryView>();
  for (const window of windows) {
    if (!isSecurityAppWindow(window)) continue;
    const appId = effectiveAppId(window);
    if (pinnedIds.has(appId) || running.has(appId)) continue;
    running.set(appId, {
      appId,
      name: formatProjectName(window.title ?? appId),
      openWindows: counts.get(appId) ?? 0,
    });
  }

  return { system, pinned: pinnedEntries, running: [...running.values()] };
}

/**
 * The views this window's app can show.
 *
 * Keyed on the **hosting OS app**, which is what renders and therefore what
 * declares them. See the note at the call site for why the other id is wrong.
 */
function panelsFor(
  window: OsWindowInstance,
  osApps: DesktopSnapshotInput["osApps"],
): readonly PanelView[] | undefined {
  return osApps.find((app) => app.appId === window.appId)?.panels;
}

/**
 * Which view it is showing.
 *
 * An app with panels is always showing one of them — there is no third state
 * where a tabbed surface displays nothing. So an unset `params.panel` means
 * "the first one", matching what the app itself falls back to, rather than
 * "unknown". Reporting unknown would let the agent conclude a panel needed
 * switching to when it was already open.
 */
function activePanelFor(
  window: OsWindowInstance,
  osApps: DesktopSnapshotInput["osApps"],
): string | undefined {
  const explicit = window.params?.panel;
  if (explicit) return explicit;
  return panelsFor(window, osApps)?.[0]?.id;
}

/**
 * The controls inside this window, each carrying what it is currently set to.
 *
 * Same lookup as panels — the **hosting** app, not the project id — and the
 * current values come from `params`, so the agent reads the filter it set two
 * steps ago rather than assuming it took. That is the same "verify, do not
 * assume" discipline the window verbs already follow, one level in.
 */
function affordancesFor(
  window: OsWindowInstance,
  osApps: DesktopSnapshotInput["osApps"],
): readonly AffordanceView[] | undefined {
  const declared = osApps.find((app) => app.appId === window.appId)?.affordances;
  if (!declared?.length) return undefined;
  return declared.map((affordance) => ({
    ...affordance,
    value: window.params?.[affordance.id] || undefined,
  }));
}

/** Build the snapshot. Handle order is creation order — see `allocateHandles`. */
export function buildDesktopSnapshot(
  input: DesktopSnapshotInput,
): DesktopSnapshot {
  const handles = allocateHandles(input.windows);

  const windows: WindowView[] = input.windows.map((window) => ({
    handle: handles.get(window.id) ?? 0,
    windowId: window.id,
    appId: effectiveAppId(window),
    title: windowTitle(window, input.osApps),
    rect: {
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    },
    isFocused: window.id === input.focusedWindowId,
    isMinimized: window.isMinimized,
    isFullScreen: window.isFullScreen,
    snappedTo: window.snappedTo,
    // Panels come from the app's registry entry, not from the window: what an
    // app *can* show is a property of the app, and asking the window would mean
    // the snapshot could only describe surfaces that had already rendered.
    //
    // **Resolved against `window.appId`, never `effectiveAppId`.** They answer
    // different questions and the difference is invisible until it bites: for a
    // security app, `params.appId` holds the *project* id, which by definition
    // is not in the OS app list, so the lookup silently missed and a project
    // window could never carry panels at all. `window.appId` names the OS app
    // actually rendering — and for an OS app the two are the same value, which
    // is exactly why the wrong one looked correct everywhere it was tested.
    panels: panelsFor(window, input.osApps),
    // What it is showing *now*, falling back to what it shows by default.
    //
    // `params.panel` is undefined until somebody sets it, so a freshly opened
    // Brain reported no active panel while visibly displaying Config. The agent
    // could not tell "showing Config" from "showing nothing", which makes
    // "switch to Memory" and "you are already there" indistinguishable.
    activePanel: activePanelFor(window, input.osApps),
    affordances: affordancesFor(window, input.osApps),
    // Overwritten by markDiff; set here so the object is complete either way.
    diff: "unchanged",
  }));

  return {
    epoch: computeEpoch(
      input.windows.map((window) => ({
        id: window.id,
        appId: effectiveAppId(window),
      })),
    ),
    mode: input.mode,
    viewport: input.viewport,
    windows: markDiff(windows, input.previous),
    dock: buildDock(input.windows, input.pinned, input.osApps),
    catalog: [...input.catalog],
  };
}

/**
 * What the OS's own apps are for, in the agent's terms.
 *
 * The registry carries dock titles, which are one word each and say nothing
 * about *when* to open something. Security apps get descriptions from
 * `project.json`; these are the equivalent, written to answer "should I open
 * this?" rather than to label a tile.
 */
export const OS_APP_AGENT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  chat: "Talk to the agent. Where narration and any reply happen — keep it visible while speaking.",
  apps: "Launchpad: browse and open the workspace's security apps.",
  "app-store":
    "Browse the full app library and request apps the workspace does not have.",
  files:
    "The file system — reports, exports and evidence produced by apps.",
  brain: "What the agent knows about this environment, and what it is working on.",
} as const;

/**
 * The apps the agent may open, as one namespace.
 *
 * Two sources, deliberately merged: the OS's own apps, and security apps from
 * the App Store catalogue **filtered to the ones the workspace actually has**.
 * Offering a locked app would have the agent confidently open something that
 * cannot open, and spend a turn discovering it.
 */
export function buildAppCatalog(
  osApps: readonly OsAppDescriptor[],
  projects: readonly Project[] | undefined,
): AppCatalogEntry[] {
  const os: AppCatalogEntry[] = osApps.map((app) => ({
    appId: app.appId,
    name: app.title,
    description: app.description,
  }));

  const security: AppCatalogEntry[] = (projects ?? [])
    .filter((project) => project.enabled !== false)
    .map((project) => ({
      appId: project.id,
      name: formatProjectName(project.name),
      description: project.description || undefined,
      tags: project.tags,
    }));

  return [...os, ...security];
}
