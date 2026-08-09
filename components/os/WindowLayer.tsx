"use client";

import { useWindowManager } from "@/lib/os/WindowManagerContext";
import { getOsApp } from "@/lib/os/registry";
import { OsWindow } from "./OsWindow";

/**
 * Renders every open window on the desktop.
 *
 * Purely a projection of window-manager state through the app registry — it
 * holds no state and has no per-app branches, so a new app appears here for
 * free once it is registered.
 *
 * Minimized windows are **hidden, not unmounted**. Removing them from the tree
 * would tear down the app inside, killing a streaming chat response or an open
 * voice session — so a minimized window keeps rendering behind
 * `visibility: hidden` and simply stops being interactive.
 */
export function WindowLayer() {
  const {
    windows,
    closeWindow,
    focusWindow,
    setWindowGeometry,
    setWindowParams,
    minimizeWindow,
    snapWindow,
    toggleFullScreen,
    focusedWindowId,
  } = useWindowManager();

  return (
    <>
      {windows.map((win) => {
        const app = getOsApp(win.appId);
        // An unknown app id means the registry changed under a live window
        // (e.g. an app removed during hot reload). Drop it rather than crash.
        if (!app) return null;
        const AppComponent = app.component;

        return (
          <div
            key={win.id}
            // `contents` keeps this wrapper out of the layout entirely when
            // visible, so the window's own absolute positioning is unaffected.
            className={win.isMinimized ? "invisible" : "contents"}
            aria-hidden={win.isMinimized || undefined}
          >
            <OsWindow
              title={win.title ?? app.title}
              x={win.x}
              y={win.y}
              width={win.width}
              height={win.height}
              z={win.z}
              isFocused={focusedWindowId === win.id}
              snappedTo={win.snappedTo}
              isFullScreen={win.isFullScreen}
              onToggleFullScreen={() => toggleFullScreen(win.id)}
              onClose={() => closeWindow(win.id)}
              onMinimize={() => minimizeWindow(win.id)}
              onSnap={(preset) => snapWindow(win.id, preset)}
              onFocus={() => focusWindow(win.id)}
              onGeometryChange={(rect) => setWindowGeometry(win.id, rect)}
            >
              <AppComponent
                windowId={win.id}
                onRequestClose={() => closeWindow(win.id)}
                params={win.params}
                setParams={(params) => setWindowParams(win.id, params)}
              />
            </OsWindow>
          </div>
        );
      })}
    </>
  );
}
