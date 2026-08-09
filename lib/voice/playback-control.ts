"use client";

/**
 * A handle on whatever is currently playing the agent's voice.
 */

export interface PlaybackControl {
  /**
   * How loud the agent is right now, 0-1.
   *
   * One method, not the `getRms`/`getLevel` pair this used to carry: both were
   * wired to the same closure and read by different callers, which is two names
   * for one number and an invitation for them to drift apart.
   */
  getLevel(): number;
  pauseFast(): void;
  resumeFast(): void;
  /** Stop talking now, because someone else is. */
  barge(): void;
}

let control: PlaybackControl | null = null;
let firstAudioAt: number | null = null;
const waiters = new Set<() => void>();

export function registerPlaybackControl(next: PlaybackControl): () => void {
  control = next;
  return () => {
    if (control === next) control = null;
  };
}

export function getPlaybackControl(): PlaybackControl | null {
  return control;
}

export function notePlaybackStarted(now = performance.now()): void {
  if (firstAudioAt !== null) return;
  firstAudioAt = now;
  for (const waiter of [...waiters]) waiter();
}

export function notePlaybackEnded(): void {
  firstAudioAt = null;
}

export function playbackHasSettled(
  settleMs: number,
  now = performance.now(),
): boolean {
  return firstAudioAt !== null && now - firstAudioAt >= settleMs;
}

export const NARRATION_GATE_TIMEOUT_MS = 3000;

export function waitForFirstAudio(timeoutMs: number): Promise<void> {
  if (firstAudioAt !== null) return Promise.resolve();
  if (!control) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      waiters.delete(finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    waiters.add(finish);
  });
}
