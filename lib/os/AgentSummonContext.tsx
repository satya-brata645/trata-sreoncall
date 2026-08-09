"use client";

/**
 * When the agent is present, and how it got here.
 *
 * One machine owning both the aurora and the command bar, because the single
 * worst failure mode for this surface is the two disagreeing — a glow with no
 * bar to type into, or a bar over a desktop nobody is driving. They are two
 * views of one state, never two states that try to stay in step.
 *
 * The other thing this enforces is the concept's central claim: **being
 * summoned and summoning itself look identical**. `origin` is recorded for
 * telemetry and for the audit record, and is deliberately *not* available to
 * anything that renders.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDesktopController } from "./DesktopControllerContext";

/**
 * `idle → summoned → driving → idle`.
 *
 * `listening` is voice's state and is not reachable yet; it is in the type so
 * Phase 3 slots in without every consumer's switch becoming non-exhaustive.
 */
export type SummonPhase = "idle" | "summoned" | "listening" | "driving";

/** Who raised the surface. Recorded, never rendered. */
export type SummonOrigin = "hotkey" | "voice" | "agent" | "arrival";

export interface AgentSummonValue {
  phase: SummonPhase;
  /** True whenever the aurora and bar should be on screen. */
  isPresent: boolean;
  origin: SummonOrigin | null;
  /** The agent's one-line reason, when it raised the surface itself. */
  reason: string | null;
  summon: (origin: SummonOrigin, reason?: string) => void;
  dismiss: () => void;
}

const AgentSummonContext = createContext<AgentSummonValue | null>(null);

/** Null off the desktop, where there is nothing to summon. */
export function useAgentSummon(): AgentSummonValue | null {
  return useContext(AgentSummonContext);
}

/**
 * Is this keystroke the summon chord?
 *
 * `⌥Space` — `Alt` plus the space bar. Checked on `code` rather than `key`
 * because Option+Space produces a non-breaking space as `key` on macOS, so
 * matching on the character would silently never fire.
 *
 * Exported for the test, which is the only way to check a chord without a
 * browser.
 */
export function isSummonChord(event: {
  code?: string;
  key?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.code === "Space" || event.key === " " || event.key === " ";
}

export function AgentSummonProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const controller = useDesktopController();

  /**
   * The only real state: is there a summons, and where did it come from.
   *
   * The phase is *derived* rather than stored. Storing it would mean an effect
   * pushing "driving" in whenever the controller starts, which is both a lint
   * error here and a genuine bug waiting to happen — two sources of truth for
   * one fact, drifting the first time an update is missed.
   */
  const [session, setSession] = useState<{
    origin: SummonOrigin;
    reason: string | null;
  } | null>(null);

  const isDriving = controller?.isDriving ?? false;

  // A finished run leaves the bar up rather than dropping to idle, so the user
  // can follow up without summoning again.
  const phase: SummonPhase = !session
    ? "idle"
    : isDriving
      ? "driving"
      : "summoned";

  // Mirrored for the keydown handler, whose closure outlives a render.
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const summon = useCallback((origin: SummonOrigin, reason?: string) => {
    // First summons wins: an agent raising the surface while the user is
    // already typing into it must not relabel where it came from.
    setSession((current) => current ?? { origin, reason: reason ?? null });
  }, []);

  const dismiss = useCallback(() => {
    // Dismissing mid-run is a stop, not just a hide. Leaving the agent driving
    // a desktop whose surface has gone is exactly the "who is doing this"
    // moment the whole design exists to avoid.
    controller?.interrupt();
    setSession(null);
  }, [controller]);

  // ⌥Space toggles. Registered on the desktop only — the ⌘K binding in
  // `HomeTabContent` belongs to the legacy surface and never coexists with this.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSummonChord(event)) {
        event.preventDefault();
        if (phaseRef.current === "idle") summon("hotkey");
        else dismiss();
        return;
      }

      if (event.key === "Escape" && phaseRef.current !== "idle") {
        // Not `preventDefault`: Escape has other jobs on this screen (closing a
        // popover, leaving a field) and stealing it would break them.
        dismiss();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [summon, dismiss]);

  const value = useMemo<AgentSummonValue>(
    () => ({
      phase,
      isPresent: phase !== "idle",
      origin: session?.origin ?? null,
      reason: session?.reason ?? null,
      summon,
      dismiss,
    }),
    [phase, session, summon, dismiss],
  );

  return (
    <AgentSummonContext.Provider value={value}>
      {children}
    </AgentSummonContext.Provider>
  );
}
