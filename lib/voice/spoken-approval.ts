"use client";

import { promptIsEchoSafe } from "./consent";
import { speakBrowserText, stopBrowserSpeech } from "./browser-playback";
import {
  clearPendingApproval,
  getPendingApproval,
  setPendingApproval,
} from "./pending-approval";

/**
 * Asking out loud, and hearing the answer.
 *
 * The pieces for this were all written and none of them were joined up:
 * `pending-approval` is a store with consumers in the voice session and **no
 * producer at all**, so `getPendingApproval()` was permanently null, the
 * session's `confirming` mode was unreachable, and `parseConsent` and
 * `promptIsEchoSafe` were dead code. Saying "yes" could not approve anything.
 *
 * This is the producer. It sits between the surface that has a decision to make
 * and the voice session that can take an answer for it, and it owns the three
 * rules that make a spoken approval safe:
 *
 * - **The question may not contain its own answer.** An agent that says "go
 *   ahead and open Launchpad?" out loud is one echo away from approving itself,
 *   because the microphone hears its own words and `parseConsent` cannot tell
 *   whose "go ahead" it was. Anything not echo-safe is replaced wholesale.
 * - **Answering clears the store.** The session leaves `confirming` when the
 *   store empties, so a responder that forgot to clear would leave the mic
 *   waiting for a yes to a question already settled.
 * - **A superseded question is denied, not dropped.** Two outstanding decisions
 *   cannot both be answered by one "yes", and an unanswered one must never be
 *   left half-open.
 *
 * Deliberately ignorant of desktop plans: it takes a sentence, not a batch, so
 * `lib/voice` stays independent of `lib/agent`. The caller renders the plan
 * (`spokenApprovalPrompt` in `lib/agent/desktop-plan-copy.ts` does exactly
 * this) and hands over the line.
 */

/**
 * What is asked when the real question cannot safely be spoken.
 *
 * It carries no detail on purpose — the card on screen has the steps, and this
 * is the case where reading them aloud is what makes them dangerous. Contains
 * no consent word, which its test asserts rather than trusts.
 */
export const NEUTRAL_APPROVAL_PROMPT = "That one needs your decision. Shall I?";

export interface SpokenApprovalOffer {
  /** Stable id for this decision; used to withdraw the right one. */
  id: string;
  /** The question, already rendered into words by the caller. */
  spoken: string;
  /** Called exactly once, with the answer. */
  respond: (approved: boolean) => void;
  /** Injectable for tests; defaults to the browser speech engine. */
  speak?: (line: string) => void;
  /** Injectable for tests; defaults to the browser speech engine. */
  stopSpeaking?: () => void;
}

/** The question as it can safely be asked. */
export function safeSpokenPrompt(spoken: string): string {
  const line = spoken.trim();
  if (!line) return NEUTRAL_APPROVAL_PROMPT;
  return promptIsEchoSafe(line) ? line : NEUTRAL_APPROVAL_PROMPT;
}

interface LiveOffer {
  id: string;
  deny: () => void;
  stopSpeaking: () => void;
}

let live: LiveOffer | null = null;

function settle(id: string, andStopSpeaking: boolean): void {
  if (live?.id !== id) return;
  const { stopSpeaking } = live;
  live = null;
  clearPendingApproval(id);
  // Only ever silences the prompt this module started. Answering while the
  // agent is still reading the question should stop it mid-sentence; answering
  // after it has moved on should not cut off whatever it moved on to.
  if (andStopSpeaking) stopSpeaking();
}

/**
 * Put a decision to the user out loud, and open the session's ear for it.
 *
 * Call this only when the turn was itself spoken. A typed turn's approval
 * belongs to the card alone: opening `confirming` for it would leave the
 * session waiting on an answer through a microphone nobody has opened.
 */
export function offerApprovalByVoice({
  id,
  spoken,
  respond,
  speak = speakBrowserText,
  stopSpeaking = stopBrowserSpeech,
}: SpokenApprovalOffer): void {
  // A second question supersedes the first, and the first fails closed.
  if (live && live.id !== id) live.deny();

  let settled = false;
  const answer = (approved: boolean) => {
    if (settled) return;
    settled = true;
    settle(id, true);
    respond(approved);
  };

  live = { id, deny: () => answer(false), stopSpeaking };

  const line = safeSpokenPrompt(spoken);
  setPendingApproval({ id, spoken: line, respond: answer });
  speak(line);
}

/**
 * Take the question back — the card was answered, or the surface went away.
 *
 * Not a denial: the caller has already decided by other means. It only stops
 * the asking, which is what lets the session leave `confirming`.
 */
export function withdrawApprovalByVoice(id: string): void {
  settle(id, true);
}

/** Deny whatever is outstanding. The fail-closed exit for timeouts and unmounts. */
export function denyPendingApprovalByVoice(): void {
  if (live) {
    live.deny();
    return;
  }
  // A store populated by something other than this module still deserves an
  // answer rather than being stranded — and clearing it is what lets the
  // session leave `confirming`, which that responder may not know to do.
  const pending = getPendingApproval();
  if (!pending) return;
  pending.respond(false);
  clearPendingApproval(pending.id);
}

export function resetSpokenApprovalForTests(): void {
  live = null;
}
