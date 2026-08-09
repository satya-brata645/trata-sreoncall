"use client";

import { useWindowManager } from "@/lib/os/WindowManagerContext";
import { OS_MENU_BAR_HEIGHT } from "@/lib/os/constants";

/**
 * The desktop with nothing on it.
 *
 * Deliberately a hint and not a home screen. The agent stages surfaces nearly
 * every time, so this is rarely seen — and the concept note is explicit that
 * the desktop is wallpaper rather than a construct: no icon arranging, no
 * drag-to-organise, no saved layout. Anything richer here would be inviting
 * exactly the filing labour the file system exists to remove.
 *
 * `pointer-events-none` because it is a caption, not a control: the dock is one
 * move away and clicking the hint should do nothing rather than something
 * surprising.
 */
export function EmptyDesktop() {
  const { windows } = useWindowManager();
  if (windows.length > 0) return null;

  return (
    <div
      aria-hidden
      style={{ top: OS_MENU_BAR_HEIGHT }}
      className="pointer-events-none absolute inset-x-0 bottom-0 left-[80px] flex animate-dos-fadeup flex-col items-center justify-center gap-md"
    >
      <span className="flex size-[60px] items-center justify-center rounded-lg border border-dashed border-role-border-strong text-heading-lg font-light text-role-icon-muted">
        +
      </span>
      <p className="dos-label text-center leading-[2.1]">
        Empty canvas
        <br />
        Open an app from the dock
      </p>
    </div>
  );
}
