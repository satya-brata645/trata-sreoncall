"use client";

import { useEffect, useState } from "react";

import { AgentSurface } from "@/components/os/AgentSurface";
import { ActionAnnouncer } from "@/components/os/ActionAnnouncer";
import { BootSplash } from "@/components/os/BootSplash";
import { DesktopCanvas } from "@/components/os/DesktopCanvas";
import { Dock } from "@/components/os/Dock";
import { EmptyDesktop } from "@/components/os/EmptyDesktop";
import { Spotlight } from "@/components/os/Spotlight";
import { WindowLayer } from "@/components/os/WindowLayer";
import { AgentSummonProvider } from "@/lib/os/AgentSummonContext";
import { DesktopControllerProvider } from "@/lib/os/DesktopControllerContext";
import { WindowManagerProvider } from "@/lib/os/WindowManagerContext";

/**
 * The desktop.
 *
 * Layers, bottom to top: the canvas (wallpaper), the windows apps open into,
 * the dock, the menu bar and command bar, and Spotlight over all of it. The
 * desktop itself holds no app-specific logic — apps arrive through the
 * registry.
 *
 * `DesktopControllerProvider` sits inside the window manager and outside
 * everything else, because it is what lets the agent drive: anything mounted
 * below it can reach the controller, and anything mounted outside a desktop
 * gets `null` and degrades to talking rather than driving.
 *
 * `AgentSummonProvider` sits inside the controller because it follows it: the
 * surface stays up for as long as a run lasts, and dismissing it stops the run.
 * `AgentSurface` renders late so the aurora and the command bar sit above every
 * other layer — the aurora is `pointer-events-none`, so being on top costs the
 * dock and menu bar nothing.
 */
export default function DesktopPage() {
  return (
    <WindowManagerProvider>
      <DesktopControllerProvider>
        <AgentSummonProvider>
          <DesktopCanvas>
            <EmptyDesktop />
            <WindowLayer />
            <Dock />
            <AgentSurface />
            <SpotlightHost />
            {/* Permanently mounted: a live region has to exist before text
                lands in it, or the first announcement is silently dropped. */}
            <ActionAnnouncer />
          </DesktopCanvas>
          <BootSplash />
        </AgentSummonProvider>
      </DesktopControllerProvider>
    </WindowManagerProvider>
  );
}

/**
 * ⌘K opens Spotlight; ⌥Space summons the agent.
 *
 * Two chords because they are two different acts — one narrows a list, the
 * other starts a conversation — and a single key that did both would make the
 * outcome depend on what you typed next.
 *
 * Mounted separately from the palette itself so the listener is bound whether
 * or not it is open, and so opening it does not remount the desktop.
 */
function SpotlightHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return open ? <Spotlight onClose={() => setOpen(false)} /> : null;
}
