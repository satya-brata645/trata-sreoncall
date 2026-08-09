"use client";

/**
 * The handle whoever is playing the agent's voice registers, so the rest of the
 * OS can ask what it is doing without knowing who it is.
 *
 * No player is registered in this build — see `mic-session.ts`. `getPlaybackControl()`
 * returning null is the honest answer, and every consumer already handles it
 * because a player can legitimately be absent between utterances.
 */

export interface PlaybackControl {
  /** Time-domain RMS of what is coming out of the speakers, 0–1. */
  getRms(): number;
  /**
   * Frequency-domain level, 0–1 — the visualizer tap. Separate from `getRms`
   * on purpose: RMS is the barge comparison and must stay a faithful energy
   * measure, while this one only has to look like the voice sounds.
   */
  getLevel(): number;
  /** Is audio still scheduled? The drain predicate. */
  isActive(): boolean;
  /** Confirmed interrupt: ramp out and discard the queue. */
  stop(): void;
}

let control: PlaybackControl | null = null;

export function registerPlaybackControl(next: PlaybackControl): () => void {
  control = next;
  return () => {
    if (control === next) control = null;
  };
}

export function getPlaybackControl(): PlaybackControl | null {
  return control;
}
