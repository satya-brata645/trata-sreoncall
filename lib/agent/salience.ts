/**
 * The bar an event has to clear before the agent even considers speaking.
 *
 * Deliberately arithmetic and deliberately not a model call. Two reasons, and
 * the second is the important one:
 *
 *  1. A model asked "does this matter" on every event is a model asked to be
 *     consistent about a threshold, which is the thing models are worst at.
 *  2. "Why did you tell me this?" needs an answer. A weight and a cut-off can
 *     be shown, argued with, and corrected. A judgement that came out of a
 *     paragraph of reasoning can only be re-rolled.
 *
 * So this decides what is *eligible* to be said, and the brain decides whether
 * to say it. Two gates, and both have to open.
 */

import type { EventSeverity, SreEvent } from "./events";

const SEVERITY_WEIGHT: Record<EventSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** The cut-off. `high` and worse always clears; everything else has to earn it. */
export const MATTERS_WEIGHT = 3;

export interface SalienceScore {
  weight: number;
  matters: boolean;
  /** In the user's words, not the code's — this is shown, not just logged. */
  because: string;
}

export function score(event: SreEvent): SalienceScore {
  const base = SEVERITY_WEIGHT[event.severity] ?? 0;
  const reasons: string[] = [`${event.severity} severity`];
  let weight = base;

  // Something a person has to *do* is worth more than something that merely
  // happened — the whole point of speaking up is to shorten the gap between
  // knowing and acting.
  if (event.actionItems.length > 0) {
    weight += 1;
    reasons.push("has action items");
  }

  // Recovery is always worth a line. An agent that reports the break and not
  // the fix leaves the user believing something is still on fire, which is a
  // worse failure than saying one thing too many.
  if (event.kind === "resolved") {
    weight = Math.max(weight, MATTERS_WEIGHT);
    reasons.push("reports a recovery");
  }

  // A claim nobody can check is not worth interrupting for — but only when the
  // claim is *all* there is. An event that says what to do, or that something
  // recovered, carries its own substance; demanding a citation for those would
  // let this tiebreak quietly undo the two promotions above, which is exactly
  // what it did before the tests caught it.
  const substantive = event.actionItems.length > 0 || event.kind === "resolved";
  if (!substantive && event.evidence.length === 0 && weight === MATTERS_WEIGHT) {
    weight -= 1;
    reasons.push("but cites no evidence");
  }

  return {
    weight,
    matters: weight >= MATTERS_WEIGHT,
    because: reasons.join(", "),
  };
}

/** Split a batch into what clears the bar and what does not. */
export function split(events: readonly SreEvent[]): {
  mattering: SreEvent[];
  rest: SreEvent[];
} {
  const mattering: SreEvent[] = [];
  const rest: SreEvent[] = [];
  for (const event of events) {
    (score(event).matters ? mattering : rest).push(event);
  }
  return { mattering, rest };
}
