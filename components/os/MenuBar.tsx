"use client";

import { useState, useSyncExternalStore } from "react";
import { ALockup } from "@/components/brand/ALogo";
import { Check, ChevronDown, Info, Lock, Mic, MicOff } from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import { OS_DOCK_Z, OS_MENU_BAR_HEIGHT } from "@/lib/os/constants";
import { useAgentMode } from "@/lib/os/agentMode";
import { useAgentPolicy } from "@/lib/hooks/useAgentPolicy";
import { useAmbientListening } from "@/lib/os/ambientListening";
import { isMicMuted, subscribeMicMuted } from "@/lib/voice/mic-session";
import { useDesktopController } from "@/lib/os/DesktopControllerContext";
import { useWindowManager } from "@/lib/os/WindowManagerContext";
import { OS_AGENT_MODES, type OsAgentMode } from "@/lib/os/agentProtocol";
import { AgentStatusChip } from "./AgentStatusChip";

/**
 * What each mode means, in the control itself.
 *
 * Written here rather than in a doc because a consent control that does not say
 * what it consents to is not consent. **Collab's line names where the boundary
 * sits** — arranging windows is free, reaching inside an app asks — which is
 * the thing a user will otherwise infer wrongly from the first time it moves a
 * window without stopping, and never go and read a threat model to correct.
 */
const MODE_COPY: Record<OsAgentMode, { label: string; detail: string }> = {
  self: {
    label: "Self",
    detail: "You drive. The agent can talk, but cannot touch your desktop.",
  },
  collab: {
    label: "Collab",
    // Says where the line actually is. The old wording — "asks before moving
    // anything" — described a product that does not exist and would have made
    // every window arrangement look like a bug when it did not stop to ask.
    detail:
      "The agent opens and arranges windows freely, and asks before changing what you are looking at inside an app.",
  },
};

function ModeMenu() {
  // Reads the workspace ceiling and publishes it into the mode store. Without
  // this the lock icon and the "your organization limits…" notice below are
  // unreachable code, and the selector offers a mode the server will silently
  // clamp back on the very next request.
  useAgentPolicy();
  const { mode, preference, ceiling, setPreference, isClamped, isAvailable } =
    useAgentMode();
  const [open, setOpen] = useState(false);
  /** Which mode has its explanation open, if any. */
  const [showing, setShowing] = useState<OsAgentMode | null>(null);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`Agent mode: ${MODE_COPY[mode].label}`}
          // The bar's control recipe: a 30px chip on the elevated step of the
          // ladder, hairline bordered. Every control up here is the same shape,
          // so the row reads as one strip rather than as three widgets.
          className={cn(
            "inline-flex h-[30px] items-center gap-[7px] rounded-xs px-3",
            "border border-role-border-default bg-role-surface-component",
            "text-body-sm font-medium text-role-content-heading",
            "transition-colors hover:bg-role-surface-component-hover",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
          )}
        >
          {MODE_COPY[mode].label}
          {/* The user picked something the org forbids — say so rather than
              silently serving them a weaker mode than the one they see. */}
          {isClamped && <Lock className="size-3 opacity-70" strokeWidth={1.5} aria-hidden />}
          <ChevronDown className="size-3 opacity-70" strokeWidth={1.5} aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={6}
          style={{ zIndex: OS_DOCK_Z + 2 }}
          className={cn("dos-glass-popover w-[320px] animate-dos-fade rounded-sm p-2xs")}
        >
          {OS_AGENT_MODES.map((candidate) => {
            const available = isAvailable(candidate);
            const selected = preference === candidate;
            const explained = showing === candidate;
            return (
              <div key={candidate} className="flex flex-col">
              <div className="flex items-start gap-3xs">
              <button
                type="button"
                disabled={!available}
                onClick={() => {
                  setPreference(candidate);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-w-0 flex-1 gap-2xs rounded-2xs p-2xs text-left transition-colors",
                  available
                    ? "hover:bg-[var(--color-role-surface-action-hover-subtle)]"
                    : "cursor-not-allowed opacity-50",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
                )}
              >
                <span aria-hidden className="flex w-4 shrink-0 justify-center pt-3xs">
                  {selected && <Check className="size-3.5 text-role-foreground-accent" strokeWidth={1.5} />}
                </span>
                <span className="flex min-w-0 flex-col gap-[2px]">
                  <span className="flex items-center gap-2xs text-body-xs font-medium text-role-content-heading">
                    {MODE_COPY[candidate].label}
                    {!available && (
                      <span className="text-body-xs font-normal text-role-content-muted">
                        · not allowed here
                      </span>
                    )}
                  </span>
                </span>
              </button>

              {/* The consequence is one click away rather than always on show.
                  Three paragraphs open at once turned a choice into a wall of
                  text, and the thing being chosen is a one-word answer. */}
              <button
                type="button"
                aria-expanded={explained}
                aria-label={`What ${MODE_COPY[candidate].label} means`}
                onClick={() => setShowing(explained ? null : candidate)}
                className={cn(
                  "mt-2xs shrink-0 rounded-2xs p-3xs transition-colors",
                  "text-role-icon-muted hover:text-role-content-body",
                  "hover:bg-[var(--color-role-surface-action-hover-subtle)]",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
                )}
              >
                <Info className="size-3.5" strokeWidth={1.5} aria-hidden />
              </button>
              </div>

              {explained && (
                <p className="px-2xs pb-2xs pl-[calc(var(--spacing-2xs)+1.25rem)] text-body-xs text-role-content-subtle">
                  {MODE_COPY[candidate].detail}
                </p>
              )}
              </div>
            );
          })}

          {ceiling !== "collab" && (
            <p className="border-t border-role-border-subtle px-2xs pb-2xs pt-xs text-body-xs text-role-content-muted">
              Your organization limits agent control to{" "}
              <strong className="font-medium">{MODE_COPY[ceiling].label}</strong>. An
              admin can change this in settings.
            </p>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * The microphone control, and its indicator.
 *
 * These are one button on purpose. A separate "listening" light next to a
 * separate switch is two things that can disagree; the control *is* the
 * indicator, so what you see is always what the microphone is doing.
 *
 * Loud when on, deliberately. Continuous audio to a third party is not
 * something to signal with a subtle tint — it gets the amber the working state
 * uses, plus a word, plus a pulse, so it cannot be mistaken for decoration or
 * missed at a glance.
 */
function MicToggle({ live }: { live: boolean }) {
  const { enabled, toggle } = useAmbientListening();
  // The preference can be on while the microphone is shut: the command bar
  // holds it muted for push-to-talk whenever the agent surface is up. Saying
  // "Mic on" through that is the control disagreeing with itself, which is the
  // one thing this component was built not to do.
  const muted = useSyncExternalStore(subscribeMicMuted, isMicMuted, () => true);
  const open = enabled && !muted;
  const Icon = open ? Mic : MicOff;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={
        enabled
          ? open
            ? "Listening for “hey SOS”. Click to stop."
            : "Listening for “hey SOS” is on, but the microphone is held closed. Click to stop."
          : "Listen for “hey SOS”. Opens your microphone."
      }
      title={
        enabled
          ? open
            ? "Listening for “hey SOS” — your microphone is open and streaming. Click to stop."
            : "Listening for “hey SOS” is on, but something is holding the microphone closed — hold Space in the command bar to talk. Click to stop."
          : "Listen for “hey SOS”. This opens your microphone and streams audio while it is on."
      }
      className={cn(
        "inline-flex h-[30px] items-center gap-2 rounded-xs border px-2.5",
        "text-body-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
        open
          ? // Continuous audio to a third party is not something to signal with
            // a subtle tint: it gets a colour, a word and a pulse, so it cannot
            // be mistaken for decoration or missed at a glance.
            "border-role-status-medium-border-hover bg-role-status-medium-subtle text-role-status-medium-foreground"
          : // On but held closed reads as neither: the preference is still on,
            // so the word stays, but nothing is being captured and the amber
            // would be claiming otherwise.
            "border-role-border-default bg-role-surface-component text-role-icon-muted hover:bg-role-surface-component-hover hover:text-role-content-heading",
      )}
    >
      <Icon size={15} strokeWidth={1.5} absoluteStrokeWidth className={cn(live && open && "animate-dos-pulse")} aria-hidden />
      {enabled && (open ? "Mic on" : "Mic held")}
    </button>
  );
}

/**
 * The menu bar.
 *
 * The desktop's only permanent chrome, and deliberately thin: everything else
 * the agent brings — the aurora, the command bar — appears for a run and
 * leaves. What stays is what the user needs to be able to reach at any moment,
 * which is exactly two things: what the agent is doing, and permission to stop
 * it doing it.
 *
 * Hides in full screen with the dock, and window geometry reserves its strip
 * (`OS_MENU_BAR_HEIGHT`), so nothing can ever be arranged on top of it.
 */
export function MenuBar({ micLive = false }: { micLive?: boolean }) {
  const { isAnyWindowFullScreen } = useWindowManager();
  const controller = useDesktopController();

  return (
    <div
      // Not <header>: this is chrome floating over a canvas, and the desktop's
      // landmark structure belongs to whatever window has focus.
      role="toolbar"
      aria-label="Desktop"
      aria-orientation="horizontal"
      style={{ zIndex: OS_DOCK_Z, height: OS_MENU_BAR_HEIGHT }}
      className={cn(
        "dos-glass-bar absolute inset-x-0 top-0",
        "flex items-center justify-between gap-sm px-md",
        "transition-[transform,opacity] duration-200 ease-out",
        // Slides *up*, not sideways — the dock's hide direction would carry the
        // bar off the wrong edge.
        isAnyWindowFullScreen && "pointer-events-none -translate-y-full opacity-0",
      )}
    >
      <ALockup />

      <div className="flex items-center gap-xs">
        <MicToggle live={micLive} />
        <AgentStatusChip status={controller?.isDriving ? "working" : "ready"} />
        <ModeMenu />
      </div>
    </div>
  );
}
