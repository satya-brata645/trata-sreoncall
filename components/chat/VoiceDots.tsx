"use client";

import { useEffect, useRef } from "react";

import { getMicRms } from "@/lib/voice/mic-session";
import { getPlaybackControl } from "@/lib/voice/playback-control";
import { cn } from "@/lib/utils";

/**
 * Three dots that move with whoever is actually talking.
 *
 * This replaces two things: a 64px brand-gradient orb and a full-width purple
 * wave. Between them they carried almost no information — the wave was always
 * the same colour whoever held the floor, and the orb only reacted to the
 * user, never to the agent (it took `assistantSpeaking` and used it solely in
 * a screen-reader string). The wave was also `position: fixed`, so inside the
 * desktop shell it escaped the chat window and painted a band across the
 * whole viewport.
 *
 * The dots are driven by real amplitude — mic RMS while you speak, player
 * level while the agent speaks — so at a glance you can tell that the mic is
 * genuinely hearing you and who currently has the floor. When there is no
 * audio to follow (thinking), they fall back to a steady pulse.
 *
 * Levels are read in a rAF loop and written straight to the DOM. No state, no
 * re-renders: this updates ~60 times a second and a React render per frame
 * would cost far more than the thing it is drawing.
 */

export type VoiceDotsState = "listening" | "thinking" | "speaking";

interface VoiceDotsProps {
  state: VoiceDotsState;
  /** `lg` for the composer slot, `sm` for the command bar. */
  size?: "sm" | "lg";
  className?: string;
}

const DOT_COUNT = 3;

/**
 * Per-dot phase, so the cluster reads as a voice rather than three things
 * doing the same thing. The middle dot leads; the outer two trail it slightly,
 * which is what makes it look like speech rather than a level meter.
 */
const DOT_PHASE = [0.72, 1, 0.72];
const DOT_LAG = [0.55, 0.75, 0.4];

/**
 * Resting scale. Silence has to stay a legible row of dots rather than three
 * specks — the indicator's first job is to say "voice is on", which it can
 * only do if you can see it before anyone has said anything.
 */
const REST_SCALE = 0.75;
const MAX_SCALE = 1.9;

/**
 * Amplitudes off a voice are small and bunched near zero; a linear map leaves
 * the dots looking almost dead. This lifts the quiet end without letting the
 * loud end clip.
 */
function shape(level: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, level)) * 1.8);
}

const STATE_COLOR: Record<VoiceDotsState, string> = {
  // Red already means "your microphone is recording" everywhere else in this
  // product. Reusing it here rather than inventing a fourth vocabulary.
  listening: "var(--color-role-status-critical-foreground)",
  // Amber, not violet: the accent is the agent's *voice*, one line below, and a
  // thinking dot in the same hue would make the two states indistinguishable at
  // this size. The menu bar's chip signals working with motion instead.
  thinking: "var(--color-role-status-medium-foreground)",
  // The agent's own voice is the violet accent — deliberately not red, which
  // would read as "you are being recorded" while it is the one talking.
  speaking: "var(--color-role-foreground-accent)",
};

const STATE_LABEL: Record<VoiceDotsState, string> = {
  listening: "Listening",
  thinking: "Working",
  speaking: "Speaking",
};

export function VoiceDots({ state, size = "lg", className }: VoiceDotsProps) {
  const dotsRef = useRef<Array<HTMLSpanElement | null>>([]);

  // `state` is a dependency rather than a ref read inside the loop: it changes
  // a handful of times per turn, so restarting the loop costs nothing, and
  // mutating a ref during render is exactly what the lint rules here forbid.
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // Held at full size rather than mid-animation, matching what
      // `.animate-dos-pulse` does under the same query: motion may stop, the
      // indicator has to stay legible.
      for (const dot of dotsRef.current) {
        if (dot) dot.style.transform = "scale(1)";
      }
      return;
    }

    let raf = 0;
    const smoothed = new Array<number>(DOT_COUNT).fill(0);

    const tick = () => {
      const current = state;
      let level = 0;
      if (current === "listening") {
        level = getMicRms();
      } else if (current === "speaking") {
        level = getPlaybackControl()?.getLevel() ?? 0;
      }

      const target = current === "thinking" ? 0 : shape(level);

      for (let i = 0; i < DOT_COUNT; i++) {
        // Per-dot easing: fast attack so a syllable registers, slower release
        // so the cluster does not strobe between words.
        const lag = DOT_LAG[i];
        const next = target > smoothed[i] ? lag : lag * 0.35;
        smoothed[i] += (target - smoothed[i]) * next;
        const dot = dotsRef.current[i];
        if (!dot) continue;
        const scale =
          REST_SCALE + smoothed[i] * DOT_PHASE[i] * (MAX_SCALE - REST_SCALE);
        dot.style.transform = `scale(${scale.toFixed(3)})`;
        dot.style.opacity = (0.45 + smoothed[i] * 0.55).toFixed(3);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const dotSize = size === "lg" ? "h-2.5 w-2.5" : "h-1.5 w-1.5";
  const gap = size === "lg" ? "gap-2" : "gap-1";

  return (
    <span
      className={cn("inline-flex items-center", gap, className)}
      role="status"
      aria-label={STATE_LABEL[state]}
    >
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            dotsRef.current[i] = el;
          }}
          aria-hidden="true"
          className={cn(
            "rounded-full will-change-transform",
            dotSize,
            // With no audio to follow there is nothing to animate from, so
            // fall back to the system's status pulse — which already has the
            // reduced-motion override this component needs.
            state === "thinking" && "animate-dos-pulse",
          )}
          style={{
            backgroundColor: STATE_COLOR[state],
            transitionProperty: "background-color",
            transitionDuration: "220ms",
            animationDelay: state === "thinking" ? `${i * 140}ms` : undefined,
          }}
        />
      ))}
    </span>
  );
}
