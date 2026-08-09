"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ALogo } from "@/components/brand/ALogo";
import { ArrowUp, Mic, MicOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { OS_DOCK_Z } from "@/lib/os/constants";
import { VoiceDots, type VoiceDotsState } from "@/components/chat/VoiceDots";
import {
  isMicMuted,
  setMicMuted,
  subscribeMicMuted,
} from "@/lib/voice/mic-session";

/**
 * The command bar — one input, at the bottom, while the agent is present.
 *
 * Deliberately not a chat window. It is the *mouth* of a run: you say the thing,
 * it narrates back, and when the run ends it leaves. Everything durable belongs
 * in Chat, which is a real app with history; this is the surface you summon and
 * forget.
 *
 * Focus behaviour is the fiddly part, and it matters more than it looks. The bar
 * takes focus when *you* summoned it, because you are about to type. It does
 * **not** when the agent raised it — you were doing something else, and yanking
 * the caret out of whatever you were mid-sentence on to announce itself would be
 * the rudest thing this feature could do.
 *
 * Mounted only while present, and keyed per summons by the caller, so the input
 * starts empty every time without an effect reaching in to clear it.
 */
export function CommandBar({
  autoFocus,
  spokenSummons = false,
  narration,
  isDriving,
  voiceState,
  transcript,
  onSubmit,
  onDismiss,
}: {
  /** True when the user summoned it. False when the agent raised it itself. */
  autoFocus: boolean;
  /**
   * The wake word raised this bar, so the microphone is already open and the
   * user is mid-sentence.
   *
   * Push-to-talk is right for a bar summoned with a chord and wrong for one
   * summoned by voice: someone who has just said "hey SOS" is about to say the
   * instruction, and muting them at exactly that moment loses it. The session
   * sits in `awake` waiting for words that can no longer reach it.
   */
  spokenSummons?: boolean;
  /** What the agent is saying right now, if anything. */
  narration?: string | null;
  isDriving: boolean;
  /**
   * What the voice session is doing, if it is doing anything. Drives the same
   * dots the chat composer shows, so voice looks identical whether it was
   * started from Chat or summoned with the hotkey.
   */
  voiceState?: VoiceDotsState | null;
  /**
   * The live partial transcript, while the mic is open.
   *
   * Rendered as the field's **value** while the mic is open, so the words
   * land where they would have if you had typed them and you can see the
   * recognition firming up in place.
   *
   * Derived rather than copied into state: `shown` falls back to whatever was
   * typed the moment the transcript clears, so there is no effect writing to
   * state (which the lint rules here forbid) and no way for the two to get out
   * of step. While the mic is open the field belongs to the voice; the instant
   * the turn dispatches, `transcript` empties and the field is yours again.
   */
  transcript?: string;
  onSubmit: (text: string) => void;
  onDismiss: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Push-to-talk.
   *
   * The bar opens **muted**. Holding Space opens the microphone; releasing it
   * closes it again. The mic button latches it open for hands-free use.
   *
   * Two reasons it defaults to muted rather than live. A bar that appears on a
   * hotkey and starts listening has taken a decision that is not its to take —
   * the gesture summons the agent, it does not consent to an open microphone.
   * And in practice a permanently live mic in a room with any noise in it
   * dispatches turns nobody asked for: an open session here picked up ambient
   * speech and answered it, repeatedly.
   *
   * `held` and `latched` are tracked separately so releasing Space cannot
   * close a microphone the button deliberately opened.
   */
  const muted = useSyncExternalStore(
    subscribeMicMuted,
    isMicMuted,
    () => true, // server render: no microphone exists yet
  );
  const [latched, setLatched] = useState(false);
  const heldRef = useRef(false);

  // Mute for the bar's own lifetime, then put the microphone back exactly as
  // it was found.
  //
  // Forcing it muted on unmount reached past this surface into a session it
  // does not own: with "hey SOS" listening enabled, one summons — even one the
  // agent raised itself — muted the shared microphone for good, and nothing on
  // screen offered to unmute it. The wake word simply stopped working, while
  // the menu-bar toggle still said it was on.
  //
  // Restoring covers the latch too: a bar that opened the microphone itself
  // found it muted at mount, so it still closes it on the way out.
  useEffect(() => {
    const wasMuted = isMicMuted();
    if (!spokenSummons) setMicMuted(true);
    return () => setMicMuted(wasMuted);
  }, [spokenSummons]);

  const releaseHold = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false;
    // A spoken summons did not open this microphone and must not close it.
    if (!latched && !spokenSummons) setMicMuted(true);
  }, [latched, spokenSummons]);

  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") releaseHold();
    };
    // Also on blur: a key-up can be lost if focus leaves mid-hold (⌘-tab),
    // and a microphone stuck open because of a swallowed event is the exact
    // failure this design exists to avoid.
    const onBlur = () => releaseHold();
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [releaseHold]);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.code !== "Space" || event.repeat) return;
    // Only when the field is empty. A leading space in an empty field carries
    // no meaning and is trimmed on submit, so it is free to reuse — but once
    // there is text, Space is a space and typing must win.
    if (event.currentTarget.value.length > 0) return;
    event.preventDefault();
    heldRef.current = true;
    setMicMuted(false);
  };

  const toggleLatch = () => {
    const next = !latched;
    setLatched(next);
    setMicMuted(!next);
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // The transcript wins while it exists; typing owns the field otherwise.
  const shown = transcript || value;

  const submit = () => {
    const text = shown.trim();
    if (!text) return;
    setValue("");
    onSubmit(text);
  };

  return (
    <div
      style={{ zIndex: OS_DOCK_Z + 10 }}
      className="absolute inset-x-0 bottom-lg flex justify-center px-lg"
    >
      <div
        role="dialog"
        aria-label="Ask the agent"
        className={cn(
          "os-glass-input w-full max-w-[720px] rounded-lg",
          "backdrop-blur-xl backdrop-saturate-150",
          "flex flex-col gap-2xs p-2xs",
        )}
      >
        {(narration || voiceState) && (
          <div className="flex items-center gap-xs px-xs pt-2xs">
            {voiceState ? <VoiceDots state={voiceState} size="sm" /> : null}
            {narration ? (
              <p
                // Polite: this changes on every action and must never
                // interrupt what a screen reader is already reading out.
                aria-live="polite"
                className="text-body-xs opacity-70"
              >
                {narration}
              </p>
            ) : null}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex items-center gap-2xs"
        >
          {/* The mark, playing.
              
              The one place besides the boot splash the animation runs: this bar
              only exists while the agent is present, so a moving mark here is
              the presence itself rather than decoration. */}
          <ALogo size={20} className="ml-2xs shrink-0" />

          <input
            ref={inputRef}
            value={shown}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              // Handled here as well as globally so the bar's own field can be
              // escaped without the keystroke having to reach `window`.
              if (event.key === "Escape") {
                event.stopPropagation();
                onDismiss();
                return;
              }
              onInputKeyDown(event);
            }}
            placeholder={isDriving ? "Working…" : "What can I help you with?"}
            aria-label="Ask the agent"
            className="min-w-0 flex-1 bg-transparent px-2xs py-xs text-body-md text-role-content-heading placeholder:text-role-content-placeholder focus:outline-none"
          />

          <button
            type="button"
            onClick={toggleLatch}
            aria-pressed={!muted}
            aria-label={
              muted ? "Turn the microphone on" : "Turn the microphone off"
            }
            title={
              muted
                ? "Hold Space to talk, or click to keep the mic on"
                : "Microphone on — click to mute"
            }
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-2xs",
              "transition-colors",
              muted
                ? "text-role-content-muted hover:bg-role-surface-component-hover hover:text-role-content-body"
                : "bg-role-status-critical-subtle text-role-status-critical-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
            )}
          >
            {muted ? (
              <MicOff className="size-4" strokeWidth={1.5} />
            ) : (
              <Mic className="size-4" strokeWidth={1.5} />
            )}
          </button>

          <button
            type="submit"
            disabled={!shown.trim()}
            aria-label="Send"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-2xs",
              "bg-role-surface-action text-role-foreground-on-inverse",
              "transition-opacity hover:opacity-90",
              "disabled:opacity-30",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
            )}
          >
            <ArrowUp className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
