"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { OS_DOCK_Z } from "@/lib/os/constants";
import { OS_APPS, SECURITY_APP_ID } from "@/lib/os/registry";
import { appGlyph } from "@/lib/os/appGlyphs";
import { usePinnedApps, type PinnedApp } from "@/lib/os/pinnedApps";
import { useWindowManager } from "@/lib/os/WindowManagerContext";
import { DockItem, type DockItemMenu } from "./DockItem";

/** Width of the invisible left-edge strip that reveals the dock in full screen. */
const REVEAL_HOT_ZONE_PX = 8;

/**
 * Divider between the dock's three groups.
 *
 * The rail is a vertical stack, so the divider is a horizontal hairline — the
 * same role the vertical line plays in the macOS Dock between permanent apps,
 * recent apps and the Trash.
 */
function DockSeparator() {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      // `border-inverse` is the border token for a dark surface, which is what
      // the glass rail is. `border-subtle` is the reflex choice and disappears
      // into it — measured at #302D36 against a rail of nearly the same value.
      className="mx-2 my-[2px] h-px shrink-0 self-stretch bg-role-border-default"
    />
  );
}

/**
 * A dock tile for a security app.
 *
 * Exists so the symbol lookup happens in its own component: `appGlyph` returns
 * a component *reference*, and resolving it inside the parent's map reads to
 * lint as building a component during render.
 */
function SecurityDockItem({
  app,
  isOpen,
  onSelect,
  menu,
}: {
  app: PinnedApp;
  isOpen: boolean;
  onSelect: () => void;
  menu: DockItemMenu;
}) {
  // The same icon the Launchpad and the store show, so an app is one object
  // wherever it appears. SREonCall's tile is its real logo, not a stand-in
  // symbol: it is the one app here that exists outside this workspace, and
  // giving it a generic glyph would quietly demote it to a fixture.
  const { artwork, icon, tint } = appGlyph(app.id);
  return (
    <DockItem
      title={app.name}
      icon={icon}
      artwork={artwork}
      tint={tint}
      isOpen={isOpen}
      onSelect={onSelect}
      menu={menu}
    />
  );
}

/**
 * The dock — the OS's only navigation.
 *
 * Vertical, pinned to the left edge, and glass (see `.os-dock` in globals.css)
 * so it floats above the desktop rather than cutting a panel out of it.
 *
 * Rendered entirely from `OS_APPS`; there are no hardcoded entries. Chat is a
 * registry entry like any other app, which is what makes "chat is part of the
 * dock" true structurally rather than by convention.
 *
 * In full screen the dock slides off the left edge and a hot zone at the screen
 * edge brings it back — the same auto-hide contract as the macOS Dock, so the
 * app genuinely owns the screen without stranding the user in it.
 */
export function Dock() {
  const {
    windows,
    openApp,
    toggleApp,
    isAppOpen,
    isAnyWindowFullScreen,
    focusWindow,
    restoreWindow,
    focusedWindowId,
  } = useWindowManager();
  const { pinned, isPinned, togglePin } = usePinnedApps();
  const [revealed, setRevealed] = useState(false);

  /**
   * Focus a window from the menu. A minimized window has to be restored rather
   * than merely raised — focusing something invisible looks like nothing
   * happened.
   */
  const revealWindow = useCallback(
    (windowId: string) => {
      const w = windows.find((x) => x.id === windowId);
      if (!w) return;
      if (w.isMinimized) restoreWindow(windowId);
      else focusWindow(windowId);
    },
    [windows, restoreWindow, focusWindow],
  );

  /**
   * The rows listing an app's open windows, ticked on the frontmost.
   *
   * `fallbackTitle` covers windows opened without one — the OS's own apps take
   * their title from the registry rather than carrying a per-instance one.
   */
  const windowRowsFor = useCallback(
    (
      belongsToApp: (w: (typeof windows)[number]) => boolean,
      fallbackTitle: string,
    ) =>
      windows.filter(belongsToApp).map((w) => ({
        id: w.id,
        title: w.title ?? fallbackTitle,
        isActive: w.id === focusedWindowId,
      })),
    [windows, focusedWindowId],
  );

  /**
   * Open a security app, optionally as an additional window.
   *
   * Extra windows of one project are otherwise indistinguishable — same app,
   * same params — so they get a numbered title. Without it the menu would list
   * two identical rows and the tick would be the only way to tell them apart.
   */
  const openSecurityApp = useCallback(
    (app: PinnedApp, forceNew = false) => {
      const count = windows.filter(
        (w) => w.appId === SECURITY_APP_ID && w.params?.appId === app.id,
      ).length;
      openApp(SECURITY_APP_ID, {
        params: { appId: app.id },
        title: forceNew && count > 0 ? `${app.name} (${count + 1})` : app.name,
        forceNew,
      });
    },
    [windows, openApp],
  );

  /** The full menu for a security app tile. */
  const securityMenu = useCallback(
    (app: PinnedApp, pinLabel: string): DockItemMenu => ({
      windows: windowRowsFor(
        (w) => w.appId === SECURITY_APP_ID && w.params?.appId === app.id,
        app.name,
      ),
      onSelectWindow: revealWindow,
      onNewWindow: () => openSecurityApp(app, true),
      pinAction: { label: pinLabel, onSelect: () => togglePin(app) },
    }),
    [windowRowsFor, revealWindow, openSecurityApp, togglePin],
  );

  /**
   * Security apps with a window open, deduped by project.
   *
   * A project can only have one window (the manager dedupes on app id + params),
   * but a minimized one still counts as open — it is exactly what the user needs
   * a dock tile to get back to.
   */
  const openSecurityApps = useMemo(() => {
    const byId = new Map<string, PinnedApp>();
    for (const w of windows) {
      if (w.appId !== SECURITY_APP_ID) continue;
      const id = w.params?.appId;
      if (!id || byId.has(id)) continue;
      byId.set(id, { id, name: w.title ?? id });
    }
    return [...byId.values()];
  }, [windows]);

  // Pinned tiles already cover any pinned app that happens to be running, so
  // this group is only the transient ones — same split as macOS, where a
  // running app you have not kept in the Dock appears after the divider and
  // disappears again when you quit it.
  const openUnpinned = openSecurityApps.filter((app) => !isPinned(app.id));

  // Delayed hide, same reason as the arrange menu: the pointer has to travel
  // from the hot zone to the rail, and hiding the instant it leaves either one
  // would make the dock impossible to actually reach.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const reveal = useCallback(() => {
    cancelHide();
    setRevealed(true);
  }, [cancelHide]);

  const hideSoon = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => setRevealed(false), 400);
  }, [cancelHide]);

  // Reset the reveal whenever full screen is entered or left, so a hover from a
  // previous session doesn't carry over and pop the dock open the moment the
  // next full screen begins.
  //
  // Adjusted during render rather than in an effect — React's documented
  // pattern for state derived from a changing input. Doing it in an effect
  // renders once with the stale value first, which the lint rule flags as a
  // cascading render. Any timer still pending is left alone: it only ever sets
  // `revealed` to false, which is already the case here.
  const [prevFullScreen, setPrevFullScreen] = useState(isAnyWindowFullScreen);
  if (prevFullScreen !== isAnyWindowFullScreen) {
    setPrevFullScreen(isAnyWindowFullScreen);
    setRevealed(false);
  }

  // A pending timer must not fire after unmount.
  useEffect(() => cancelHide, [cancelHide]);

  const hidden = isAnyWindowFullScreen && !revealed;

  return (
    <TooltipProvider delayDuration={300}>
      {/* Reveal strip — only while full screen, so it can never intercept a
          pointer meant for an app in normal use. */}
      {isAnyWindowFullScreen && (
        <div
          aria-hidden
          onMouseEnter={reveal}
          style={{ zIndex: OS_DOCK_Z, width: REVEAL_HOT_ZONE_PX }}
          className="absolute inset-y-0 left-0"
        />
      )}

      <nav
        aria-label="Dock"
        // `top-1/2 -translate-y-1/2` centres the rail vertically, so the dock
        // stays put as apps are added instead of growing downward from the top.
        style={{ zIndex: OS_DOCK_Z }}
        onMouseEnter={reveal}
        onMouseLeave={isAnyWindowFullScreen ? hideSoon : undefined}
        className={cn(
          "os-dock absolute left-[14px] top-1/2 -translate-y-1/2",
          // Glass blur + saturation. Utilities rather than CSS — see the note in
          // the `.os-dock` rule.
          "backdrop-blur-[40px] backdrop-saturate-150",
          // A pill, not a panel: the dock radius is the widest in the system,
          // which is what keeps it reading as an object floating on the desktop
          // rather than a strip cut into the edge. Padding is what makes the
          // glass readable — at 4px the tiles cover the rail almost entirely and
          // the frost is reduced to a sliver.
          "flex flex-col items-center gap-1.5 rounded-xl px-[7px] py-[9px]",
          "transition-[transform,opacity] duration-200 ease-out",
          hidden && "os-dock--hidden",
        )}
      >
        {/* 1 — the OS's own apps. Always present, never reorderable, no pin
            affordance: they are the product, not a preference. Each is drawn
            rather than glyphed, the way Finder and Launchpad are: these five
            are the surfaces someone reaches for a hundred times a day, and a
            column of identical grey squares makes every one of those reaches a
            reading task. */}
        {OS_APPS.filter((app) => app.showInDock !== false).map((app) => (
          <DockItem
            key={app.id}
            title={app.title}
            icon={app.icon}
            artwork={app.artwork}
            isOpen={isAppOpen(app.id)}
            onSelect={() => toggleApp(app.id)}
            menu={{
              windows: windowRowsFor((w) => w.appId === app.id, app.title),
              onSelectWindow: revealWindow,
              // No New Window: these are singletons by design, so the item
              // would be present and do nothing. No pin action either — they
              // are permanent.
            }}
          />
        ))}

        {/* 2 — security apps kept in the dock. Persisted, so they are here
            whether or not they are running. */}
        {pinned.length > 0 && <DockSeparator />}
        {pinned.map((app) => (
          <SecurityDockItem
            key={app.id}
            app={app}
            isOpen={isAppOpen(SECURITY_APP_ID, { appId: app.id })}
            onSelect={() =>
              toggleApp(SECURITY_APP_ID, {
                params: { appId: app.id },
                title: app.name,
              })
            }
            menu={securityMenu(app, "Remove from Dock")}
          />
        ))}

        {/* 3 — running but not kept. These come and go with their windows. */}
        {openUnpinned.length > 0 && <DockSeparator />}
        {openUnpinned.map((app) => (
          <SecurityDockItem
            key={app.id}
            app={app}
            isOpen
            onSelect={() =>
              toggleApp(SECURITY_APP_ID, {
                params: { appId: app.id },
                title: app.name,
              })
            }
            menu={securityMenu(app, "Keep in Dock")}
          />
        ))}
      </nav>
    </TooltipProvider>
  );
}
