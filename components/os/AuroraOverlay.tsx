"use client";

import { cn } from "@/lib/utils";
import { OS_DOCK_Z } from "@/lib/os/constants";

/**
 * The aurora — a soft animated glow around the edge of the screen while the
 * agent is present.
 *
 * Built the way `VoiceWaveOverlay` is, because that component solved the same
 * problem: a full-bleed decoration that must never intercept a pointer, must
 * fade rather than pop, and must not cost a repaint of the app underneath.
 *
 * **Edges only.** The glow is a full-viewport gradient stack masked down to a
 * border band. Doing it as an inset box-shadow would tint the whole desktop and
 * make every window read as disabled; masking keeps the middle of the screen
 * completely untouched, which is where the user is actually looking.
 *
 * **The colour is the violet accent**, from the design tokens rather than
 * hardcoded — this is the one moment the product signs its own name on the
 * screen, and violet is the one hue the system lets mean "the agent is here".
 */

/** How long the fade lasts. Long enough to read as arrival, short enough not to lag. */
const FADE_MS = 420;

/** Thickness of the glowing band, as a share of the viewport's short edge. */
const BAND = "18%";

export function AuroraOverlay({
  active,
  speaking = false,
}: {
  active: boolean;
  /** True while someone is mid-utterance. Makes the glow breathe. */
  speaking?: boolean;
}) {
  // Always mounted, never conditionally rendered.
  //
  // The obvious version — mount on `active`, unmount after the fade — needs two
  // pieces of state and an effect to sequence them, because an element that
  // appears already at its final opacity never transitions. Leaving it in the
  // tree at `opacity: 0` makes the transition work in both directions for free.
  // It costs nothing: a fully transparent, `pointer-events-none` layer with no
  // running animation is not composited.
  return (
    <div
      aria-hidden
      // `pointer-events-none` is load-bearing, not hygiene: this sits above the
      // dock and the menu bar, so without it the agent's own glow would make
      // the user's off-switch unclickable.
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        "transition-opacity ease-out",
        // Brighter while someone is talking, so the glow reads as listening
        // rather than merely present. Opacity rather than a colour change —
        // the accent is the one thing here that must not shift.
        active ? (speaking ? "opacity-100" : "opacity-75") : "opacity-0",
      )}
      style={{ zIndex: OS_DOCK_Z + 5, transitionDuration: `${FADE_MS}ms` }}
    >
      {/*
        Two stacked layers. One alone reads as a flat vignette; two at
        different angles, blurs and opacities give the band depth, so the light
        looks like it is coming through the edge rather than painted on it.

        The mask is what makes this an edge glow: a linear gradient per axis,
        opaque at the borders and transparent across the middle, intersected so
        only the frame survives.
      */}
      <div
        className="absolute inset-[-25%]"
        style={{
          background: `radial-gradient(60% 60% at 20% 20%, var(--dos-violet) 0%, transparent 70%),
                       radial-gradient(55% 55% at 85% 75%, var(--dos-violet-dim) 0%, transparent 70%)`,
          opacity: 0.55,
          filter: "blur(64px)",
          WebkitMaskImage: `linear-gradient(to right, black 0%, transparent ${BAND}, transparent calc(100% - ${BAND}), black 100%),
                            linear-gradient(to bottom, black 0%, transparent ${BAND}, transparent calc(100% - ${BAND}), black 100%)`,
          maskImage: `linear-gradient(to right, black 0%, transparent ${BAND}, transparent calc(100% - ${BAND}), black 100%),
                      linear-gradient(to bottom, black 0%, transparent ${BAND}, transparent calc(100% - ${BAND}), black 100%)`,
          WebkitMaskComposite: "source-over",
          maskComposite: "add",
        }}
      />
      <div
        className="absolute inset-[-25%]"
        style={{
          background: `radial-gradient(50% 50% at 80% 15%, var(--dos-violet-dim) 0%, transparent 70%),
                       radial-gradient(65% 65% at 10% 90%, var(--dos-violet) 0%, transparent 70%)`,
          opacity: 0.45,
          filter: "blur(80px)",
          WebkitMaskImage: `linear-gradient(to right, black 0%, transparent ${BAND}, transparent calc(100% - ${BAND}), black 100%),
                            linear-gradient(to bottom, black 0%, transparent ${BAND}, transparent calc(100% - ${BAND}), black 100%)`,
          maskImage: `linear-gradient(to right, black 0%, transparent ${BAND}, transparent calc(100% - ${BAND}), black 100%),
                      linear-gradient(to bottom, black 0%, transparent ${BAND}, transparent calc(100% - ${BAND}), black 100%)`,
          WebkitMaskComposite: "source-over",
          maskComposite: "add",
        }}
      />
    </div>
  );
}
