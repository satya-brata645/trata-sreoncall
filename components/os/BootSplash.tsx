"use client";

import { useEffect, useState } from "react";

import { ALogo } from "@/components/brand/ALogo";
import { OS_DOCK_Z } from "@/lib/os/constants";

/** How long the mark holds before the desktop takes over. */
export const BOOT_DURATION_MS = 2600;

/**
 * The boot splash.
 *
 * The one place the mark plays at size, and the only animation in the system
 * that is not a status pulse. It earns the exception by being the moment the
 * OS is claiming: everything after it is enterprise density and stillness.
 *
 * Mounted once per session and then gone — it does not reappear on navigation,
 * because a boot that happens twice is a loading spinner wearing a costume.
 */
export function BootSplash() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setGone(true), BOOT_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  if (gone) return null;

  return (
    <div
      aria-hidden
      style={{ zIndex: OS_DOCK_Z + 10, animationDelay: `${BOOT_DURATION_MS - 400}ms` }}
      className="fixed inset-0 flex flex-col items-center justify-center gap-lg bg-role-surface-page [animation:dos-splashout_.4s_ease_forwards]"
    >
      <ALogo size={120} />
      <p className="dos-label tracking-[0.36em]">Developer Operating System</p>
    </div>
  );
}
