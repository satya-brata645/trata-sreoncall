"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  OS_DOCK_INSET_CELLS,
  OS_GRID_CELL,
  OS_WINDOW_BASE_Z,
  OS_WINDOW_CASCADE,
  OS_WINDOW_MIN_SIZE,
  OS_WINDOW_OPEN_MARGIN_CELLS,
  OS_MENU_BAR_HEIGHT,
} from "./constants";
import { getOsApp } from "./registry";
import { snapRect, type OsRect, type OsSnapPreset } from "./geometry";
import type { OsAppId, OsWindowInstance } from "./types";

/**
 * Does this window represent the given app instance?
 *
 * With no params key the match is by app id alone — the right question for a
 * singleton like Chat. With one, params must match too, which is what separates
 * two security apps that share the `security-app` registry id. Serialised the
 * same way `openApp` builds its key, so the two agree by construction.
 */
function matchesWindow(
  w: OsWindowInstance,
  appId: OsAppId,
  paramsKey: string | undefined,
): boolean {
  if (w.appId !== appId) return false;
  return paramsKey === undefined || JSON.stringify(w.params) === paramsKey;
}

interface WindowManagerValue {
  windows: OsWindowInstance[];
  /**
   * Open an app, or focus it if it is a singleton that is already open.
   *
   * `options.params` are handed to the app component, and `options.title`
   * overrides the registry title — together these let one registry entry serve
   * many instances (one window per security app, for example). A non-singleton
   * app with matching params focuses the existing window rather than stacking
   * duplicates of the same thing.
   *
   * `options.forceNew` opts out of that focusing, which is what the dock's
   * "New Window" needs. Singletons ignore it — their whole contract is that a
   * second window must not exist, and that is enforced here rather than trusted
   * to every caller.
   */
  openApp: (
    appId: OsAppId,
    options?: {
      params?: Record<string, string>;
      title?: string;
      forceNew?: boolean;
    },
  ) => void;
  closeWindow: (windowId: string) => void;
  /**
   * Merge new params into an open window.
   *
   * Merged rather than replaced so a caller changing one key does not silently
   * drop another — a security app's `appId` must survive the agent focusing a
   * panel inside it.
   *
   * Deliberately does not touch focus or stacking. Changing what a window shows
   * is not the same as asking to look at it, and conflating them would make
   * every inside-app move steal the user's attention.
   */
  setWindowParams: (windowId: string, params: Record<string, string>) => void;
  /** Bring a window to the front. Safe to call on every pointer-down. */
  focusWindow: (windowId: string) => void;
  /**
   * Apply a new rectangle to a window. Covers both moving and resizing — the
   * window reports a complete rect, so this needs no notion of which gesture
   * produced it.
   */
  setWindowGeometry: (windowId: string, rect: OsRect) => void;
  /** Hide a window without unmounting it, so in-flight work survives. */
  minimizeWindow: (windowId: string) => void;
  /** Un-hide a minimized window and bring it to the front. */
  restoreWindow: (windowId: string) => void;
  /**
   * Apply a one-click arrangement. Re-applying the active preset un-snaps and
   * returns the window to the rectangle it had before it was first snapped.
   */
  snapWindow: (windowId: string, preset: OsSnapPreset) => void;
  /**
   * Enter or leave full screen. Entering records the current rectangle and
   * takes the whole viewport; leaving restores that rectangle exactly.
   */
  toggleFullScreen: (windowId: string) => void;
  /** True while any window is full screen — the dock uses this to get out of the way. */
  isAnyWindowFullScreen: boolean;
  /**
   * Minimize if frontmost, restore if minimized, open if neither — the dock's
   * click. `options` are forwarded to `openApp` and also narrow which instance
   * is being toggled, so one security app's tile never minimizes another's.
   */
  toggleApp: (
    appId: OsAppId,
    options?: { params?: Record<string, string>; title?: string },
  ) => void;
  isAppOpen: (appId: OsAppId, params?: Record<string, string>) => boolean;
  /** Id of the frontmost window, or null when the desktop is empty. */
  focusedWindowId: string | null;
}

const WindowManagerContext = createContext<WindowManagerValue | null>(null);

export function useWindowManager(): WindowManagerValue {
  const ctx = useContext(WindowManagerContext);
  if (!ctx) {
    throw new Error("useWindowManager must be used within WindowManagerProvider");
  }
  return ctx;
}

/**
 * Owns every open window on the desktop.
 *
 * Deliberately app-agnostic: it resolves sizes and titles through the registry
 * and never branches on a specific app id. Adding an app requires no change
 * here.
 *
 * Window geometry lives in React state rather than the URL. Which app is open
 * is a property of the desktop session, not an address — and app-internal
 * identity (the open chat thread, say) is owned by the app itself.
 */
export function WindowManagerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [windows, setWindows] = useState<OsWindowInstance[]>([]);
  // Monotonic so a re-focused window always lands above every sibling; never
  // reset, because reusing a z value would make stacking order ambiguous.
  const topZRef = useRef(OS_WINDOW_BASE_Z);
  // `useId` keeps generated window ids stable across a hydration pass and
  // unique per provider instance, avoiding Math.random/Date.now in render.
  const idPrefix = useId();
  const windowSeqRef = useRef(0);

  const nextZ = useCallback(() => {
    topZRef.current += 1;
    return topZRef.current;
  }, []);

  const focusWindow = useCallback(
    (windowId: string) => {
      const target = windows.find((w) => w.id === windowId);
      // Already frontmost — skip the state write so a pointer-down on the
      // focused window doesn't rerender the whole layer on every click.
      if (!target || target.z === topZRef.current) return;
      // `nextZ` mutates a ref, so it is called here in the event handler rather
      // than inside the updater below: React invokes state updaters twice in
      // development StrictMode, and a mutation in there fires twice per action.
      const z = nextZ();
      setWindows((prev) =>
        prev.map((w) => (w.id === windowId ? { ...w, z } : w)),
      );
    },
    [windows, nextZ],
  );

  const openApp = useCallback(
    (
      appId: OsAppId,
      options?: {
        params?: Record<string, string>;
        title?: string;
        forceNew?: boolean;
      },
    ) => {
      const app = getOsApp(appId);
      if (!app) return;

      // A singleton's contract is enforced here, not at the call site.
      const forceNew = options?.forceNew === true && !app.singleton;

      const paramsKey = options?.params
        ? JSON.stringify(options.params)
        : undefined;

      // Everything that mutates a ref happens here, in the event handler.
      // React invokes state updaters twice under development StrictMode, so a
      // counter bumped inside one advances twice per action — which is exactly
      // why a second window used to cascade two steps instead of one.
      const z = nextZ();
      windowSeqRef.current += 1;
      const newWindowId = `${idPrefix}-win-${windowSeqRef.current}`;

      setWindows((prev) => {
        // Re-opening the same thing focuses it instead of stacking a duplicate:
        // singletons match on app id, parameterised apps on app id + params.
        const existing = forceNew
          ? undefined
          : app.singleton
            ? prev.find((w) => w.appId === appId)
            : paramsKey
              ? prev.find(
                  (w) =>
                    w.appId === appId && JSON.stringify(w.params) === paramsKey,
                )
              : undefined;
        if (existing) {
          // Also un-minimize: launching an app the user has put away should
          // bring it back, not silently focus something invisible.
          return prev.map((w) =>
            w.id === existing.id ? { ...w, z, isMinimized: false } : w,
          );
        }

        // Derived from how many windows are already open — a pure expression,
        // so a double-invoked updater produces the same answer.
        const step = prev.length % OS_WINDOW_CASCADE.maxSteps;

        // Open filling most of the desktop. A freshly launched app is the thing
        // you want to look at, so it takes the available area minus the dock
        // column and a one-cell margin, rather than a fixed size that would need
        // resizing on any large display.
        const cascadeOffset =
          step * OS_WINDOW_CASCADE.stepCells * OS_GRID_CELL;
        const x =
          OS_WINDOW_OPEN_MARGIN_CELLS.left * OS_GRID_CELL + cascadeOffset;
        // The menu bar owns the top strip, so a freshly opened window starts
        // below it rather than underneath it.
        const y =
          OS_MENU_BAR_HEIGHT +
          OS_WINDOW_OPEN_MARGIN_CELLS.top * OS_GRID_CELL +
          cascadeOffset;

        // The cascade offset comes out of the size too, so the Nth window still
        // ends inside the right/bottom margin instead of running off-screen.
        const availableWidth =
          window.innerWidth - x - OS_WINDOW_OPEN_MARGIN_CELLS.right * OS_GRID_CELL;
        const availableHeight =
          window.innerHeight - y - OS_WINDOW_OPEN_MARGIN_CELLS.bottom * OS_GRID_CELL;

        // Floor at the hard minimum so the title bar stays usable even on a
        // viewport too small for the margins.
        const width = Math.max(OS_WINDOW_MIN_SIZE.width, availableWidth);
        const height = Math.max(OS_WINDOW_MIN_SIZE.height, availableHeight);

        return [
          ...prev,
          {
            id: newWindowId,
            appId,
            x,
            y,
            width,
            height,
            z,
            isMinimized: false,
            isFullScreen: false,
            params: options?.params,
            title: options?.title,
          },
        ];
      });
    },
    [idPrefix, nextZ],
  );

  const closeWindow = useCallback((windowId: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== windowId));
  }, []);

  const setWindowParams = useCallback(
    (windowId: string, params: Record<string, string>) => {
      setWindows((prev) =>
        prev.map((w) =>
          w.id === windowId ? { ...w, params: { ...w.params, ...params } } : w,
        ),
      );
    },
    [],
  );

  const setWindowGeometry = useCallback((windowId: string, rect: OsRect) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === windowId
          ? {
              // A manual drag or resize breaks the arrangement, so clear the
              // snap state — otherwise the menu would keep showing the window
              // as snapped to a region it no longer occupies.
              ...w,
              ...rect,
              snappedTo: undefined,
              restoreRect: undefined,
            }
          : w,
      ),
    );
  }, []);

  const minimizeWindow = useCallback((windowId: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === windowId ? { ...w, isMinimized: true } : w)),
    );
  }, []);

  const restoreWindow = useCallback(
    (windowId: string) => {
      // `nextZ` mutates a ref, so it stays outside the updater — see the note
      // in `focusWindow`.
      const z = nextZ();
      setWindows((prev) =>
        prev.map((w) =>
          w.id === windowId ? { ...w, isMinimized: false, z } : w,
        ),
      );
    },
    [nextZ],
  );

  const snapWindow = useCallback((windowId: string, preset: OsSnapPreset) => {
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== windowId) return w;

        // Re-applying the active arrangement toggles back to the pre-snap
        // rectangle, the way macOS does.
        if (w.snappedTo === preset && w.restoreRect) {
          return {
            ...w,
            ...w.restoreRect,
            snappedTo: undefined,
            restoreRect: undefined,
          };
        }

        const bounds = { width: window.innerWidth, height: window.innerHeight };
        // Reserve the dock's column so a left-half window doesn't slide under
        // it. The dock is inset one cell and is roughly two cells wide.
        const inset = {
          left: OS_GRID_CELL * (OS_DOCK_INSET_CELLS + 2),
          top: OS_MENU_BAR_HEIGHT,
        };
        const rect = snapRect(preset, bounds, inset);

        return {
          ...w,
          ...rect,
          snappedTo: preset,
          // Only capture the restore point on the first snap, so snapping
          // left→right→left still returns to the original free-floating rect.
          restoreRect:
            w.restoreRect ??
            { x: w.x, y: w.y, width: w.width, height: w.height },
        };
      }),
    );
  }, []);

  const toggleFullScreen = useCallback(
    (windowId: string) => {
      // `nextZ` mutates a ref, so it is called here rather than inside the
      // updater — React double-invokes updaters under StrictMode.
      const z = nextZ();
      setWindows((prev) =>
        prev.map((w) => {
          if (w.id !== windowId) return w;

          if (w.isFullScreen) {
            // Leaving: restore the exact frame captured on entry. Falls back to
            // the current rect if somehow absent, so this can never produce a
            // zero-sized window.
            const rect = w.preFullScreenRect ?? {
              x: w.x,
              y: w.y,
              width: w.width,
              height: w.height,
            };
            return {
              ...w,
              ...rect,
              isFullScreen: false,
              preFullScreenRect: undefined,
              z,
            };
          }

          // Entering: the whole viewport, no dock reservation and no margin.
          return {
            ...w,
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight,
            isFullScreen: true,
            preFullScreenRect: {
              x: w.x,
              y: w.y,
              width: w.width,
              height: w.height,
            },
            // A full-screen window is no longer in a tiled arrangement.
            snappedTo: undefined,
            restoreRect: undefined,
            z,
          };
        }),
      );
    },
    [nextZ],
  );

  const isAnyWindowFullScreen = useMemo(
    () => windows.some((w) => w.isFullScreen && !w.isMinimized),
    [windows],
  );

  const isAppOpen = useCallback(
    (appId: OsAppId, params?: Record<string, string>) => {
      const key = params ? JSON.stringify(params) : undefined;
      return windows.some((w) => matchesWindow(w, appId, key));
    },
    [windows],
  );

  const toggleApp = useCallback(
    (
      appId: OsAppId,
      options?: { params?: Record<string, string>; title?: string },
    ) => {
      // Security apps all share one registry id, so matching on `appId` alone
      // would treat every open project as the same app — one dock tile would
      // minimize another's window. Params narrow it to the specific instance.
      const key = options?.params ? JSON.stringify(options.params) : undefined;
      const open = windows.filter((w) => matchesWindow(w, appId, key));
      if (open.length === 0) {
        openApp(appId, options);
        return;
      }
      const topmost = open.reduce((a, b) => (a.z > b.z ? a : b));

      // Put away → bring back. A minimized app is invisible, so a dock click
      // can only mean "show me", never "close".
      if (topmost.isMinimized) {
        restoreWindow(topmost.id);
        return;
      }

      // Frontmost visible window belongs to this app → the user is looking at
      // it, so a dock click means "put it away". Minimize rather than close, so
      // in-flight work is never destroyed by a single click.
      const visible = windows.filter((w) => !w.isMinimized);
      const frontmost =
        visible.length > 0
          ? visible.reduce((a, b) => (a.z > b.z ? a : b))
          : null;

      if (frontmost && matchesWindow(frontmost, appId, key)) {
        minimizeWindow(topmost.id);
      } else {
        focusWindow(topmost.id);
      }
    },
    [windows, openApp, focusWindow, minimizeWindow, restoreWindow],
  );

  const focusedWindowId = useMemo(() => {
    const visible = windows.filter((w) => !w.isMinimized);
    if (visible.length === 0) return null;
    return visible.reduce((a, b) => (a.z > b.z ? a : b)).id;
  }, [windows]);

  const value = useMemo<WindowManagerValue>(
    () => ({
      windows,
      openApp,
      closeWindow,
      focusWindow,
      setWindowParams,
      setWindowGeometry,
      minimizeWindow,
      restoreWindow,
      snapWindow,
      toggleFullScreen,
      isAnyWindowFullScreen,
      toggleApp,
      isAppOpen,
      focusedWindowId,
    }),
    [
      windows,
      openApp,
      closeWindow,
      focusWindow,
      setWindowParams,
      setWindowGeometry,
      minimizeWindow,
      restoreWindow,
      snapWindow,
      toggleFullScreen,
      isAnyWindowFullScreen,
      toggleApp,
      isAppOpen,
      focusedWindowId,
    ],
  );

  return (
    <WindowManagerContext.Provider value={value}>
      {children}
    </WindowManagerContext.Provider>
  );
}
