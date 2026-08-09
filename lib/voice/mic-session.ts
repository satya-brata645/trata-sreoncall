"use client";

/**
 * The microphone, as far as the desktop is concerned.
 *
 * Trata's OS core ships without a speech pipeline: there is no STT provider, no
 * TTS, and **nothing captures audio**. What survives from the full product is
 * the part the shell depends on — a mute preference the menu bar and command
 * bar both read, and an RMS reading the voice dots animate from.
 *
 * `getMicRms()` therefore returns 0 and the dots rest. That is deliberate over
 * faking a waveform: an indicator that moves when nothing is listening is a lie
 * the user cannot detect, and this is exactly the surface where that matters.
 * When a real session lands it replaces this module, and every consumer keeps
 * working because the signatures do not change.
 */

let muted = false;
const mutedListeners = new Set<(muted: boolean) => void>();
const stateListeners = new Set<() => void>();

export function setMicMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  for (const listener of mutedListeners) listener(muted);
  for (const listener of stateListeners) listener();
}

export function isMicMuted(): boolean {
  return muted;
}

export function subscribeMicMuted(listener: (muted: boolean) => void): () => void {
  mutedListeners.add(listener);
  return () => mutedListeners.delete(listener);
}

export function subscribeMicState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Whether a session is actually open. Never, until a pipeline exists. */
export function getMicLive(): boolean {
  return false;
}

/** The server's answer, kept separate so `useSyncExternalStore` can hydrate. */
export function getMicLiveServer(): boolean {
  return false;
}

export function isMicSupported(): boolean {
  return (
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
  );
}

/** Input level, 0–1. Zero while nothing is capturing. */
export function getMicRms(): number {
  return 0;
}
