"use client";

/**
 * What the agent just did, said out loud to assistive technology.
 *
 * `UX-21` is a MUST — *"Every action MUST be announced to assistive technology
 * via a polite live region"* — and `NFR-11` gives the reason: a desktop that
 * rearranges itself silently is unusable with a screen reader. Until now the
 * only live regions on the desktop were the status chip (`"Ready"` / `"Working"`)
 * and the command bar's narration, so a window snapping to the right half was
 * completely silent.
 *
 * **The string already existed.** `StepOutcome.detail` is documented in
 * `agentProtocol.ts` as having *"three consumers: it goes to the model, into
 * the audit record, and into the live region announced to assistive tech — and
 * those must never disagree about what happened."* Two of the three were
 * built. This is the third, and using the same string is the point: the
 * sighted user, the screen-reader user, the model and the audit record all get
 * one account of what happened.
 *
 * Module scope for the usual reason — the batch runs in
 * `DesktopControllerContext` and the region renders in the menu bar's tree.
 * Same shape as `agent-speech.ts` and `pending-approval.ts`.
 */

import { useSyncExternalStore } from "react";

/**
 * The last thing announced, and a counter.
 *
 * The counter is not decoration: two identical actions in a row ("Moved
 * Pentest to the left half" twice) produce the same string, and a live region
 * whose text has not changed is not re-read. Bumping a key alongside it forces
 * the region to re-announce, which is what the user needs — the second move
 * happened too.
 */
export interface Announcement {
  message: string;
  seq: number;
}

const SILENT: Announcement = { message: "", seq: 0 };

/**
 * How long the last announcement stays after a run ends.
 *
 * Long enough that a reader partway through the final sentence is not cut off
 * mid-word, short enough that it is gone before it could be mistaken for
 * something new. Clearing instantly is the bug this avoids.
 */
export const ANNOUNCEMENT_LINGER_MS = 4000;

let current: Announcement = SILENT;
const listeners = new Set<() => void>();

/**
 * Announce one completed step.
 *
 * Called from the executor's loop rather than from a component, so it fires
 * per *action* and not per render — `UX-21` says every action, and a component
 * that announced on re-render would announce a batch of four as one.
 */
export function announceAction(message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  current = { message: trimmed, seq: current.seq + 1 };
  for (const listener of listeners) listener();
}

/**
 * Clear it once the run is over.
 *
 * Without this the last action stays in the region indefinitely, and any
 * screen reader that re-reads its live regions would announce a window move
 * from ten minutes ago as if it had just happened.
 */
export function clearAnnouncements(): void {
  if (current === SILENT) return;
  current = SILENT;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Announcement {
  return current;
}

/** Stable SSR snapshot — nothing has been announced on the server. */
function getServerSnapshot(): Announcement {
  return SILENT;
}

export function useAnnouncement(): Announcement {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Read outside React.
 *
 * Same shape as `getAgentSpeech()` in `lib/voice/agent-speech.ts`. A store
 * whose only reader is a hook can only be tested through a component, which is
 * a lot of harness for a value this simple.
 */
export function getAnnouncement(): Announcement {
  return current;
}

/** Subscribe outside React. Same reason as `getAnnouncement`. */
export function subscribeAnnouncements(listener: () => void): () => void {
  return subscribe(listener);
}

/** Test seam. */
export function resetAnnouncementsForTests(): void {
  current = SILENT;
  listeners.clear();
}
