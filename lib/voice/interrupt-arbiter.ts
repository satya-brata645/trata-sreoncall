/**
 * Was that a real interruption, or the agent hearing itself?
 *
 * Decided locally and arithmetically. This file used to carry the client half
 * of a server contract — a system prompt, a request builder and a verdict
 * parser for a relay that was never built and has no route — alongside a local
 * fallback that compared the transcript to the agent's line by substring.
 * Recognition never returns a clean substring of synthesised speech, so that
 * fallback almost never matched: every word the microphone caught off the
 * speakers counted as a real interruption, and the agent dispatched its own
 * sentence back to itself as the user's next instruction.
 *
 * What is left is the check that works, and it stays local on purpose. Barge-in
 * has to decide inside a couple of hundred milliseconds; a model round trip
 * cannot, and being slow to stop talking is the failure this whole path exists
 * to avoid.
 */

export type InterruptVerdict = "interrupt" | "ignore";

export interface ArbiterDecision {
  verdict: InterruptVerdict;
  reason: string;
}

export const MIN_WORDS_FOR_ARBITER = 2;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function worthArbitrating(text: string): boolean {
  return wordCount(text) >= MIN_WORDS_FOR_ARBITER;
}

/*
 * Token overlap rather than substring: how much of what was heard also appears
 * in what is being said. That survives dropped and reordered words, which is
 * exactly what echo looks like coming back through a microphone.
 */

/** Above this share of heard words appearing in the agent's line, it is echo. */
export const ECHO_SIMILARITY = 0.6;

/**
 * Said to stop someone, and short enough to be discarded as noise otherwise.
 *
 * These bypass both the length gate and the overlap test: "stop" is one word,
 * and the agent may well have just said it, but a person saying it over the
 * top of the agent means it.
 */
const STOP_PHRASES = [
  "stop",
  "wait",
  "hold on",
  "hang on",
  "no",
  "nope",
  "cancel",
  "actually",
  "never mind",
  "nevermind",
  "shut up",
  "quiet",
  "enough",
];

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Share of the transcript's words that also occur in the agent's line. */
export function echoSimilarity(transcript: string, agentLine: string): number {
  const heard = tokens(transcript);
  if (heard.length === 0) return 0;

  // A multiset so a line repeating one word cannot absorb a transcript that
  // repeats a different one.
  const remaining = new Map<string, number>();
  for (const word of tokens(agentLine)) {
    remaining.set(word, (remaining.get(word) ?? 0) + 1);
  }

  let matched = 0;
  for (const word of heard) {
    const left = remaining.get(word) ?? 0;
    if (left <= 0) continue;
    remaining.set(word, left - 1);
    matched += 1;
  }
  return matched / heard.length;
}

export function isStopPhrase(transcript: string): boolean {
  const normalised = tokens(transcript).join(" ");
  if (!normalised) return false;
  return STOP_PHRASES.some(
    (phrase) => normalised === phrase || normalised.startsWith(`${phrase} `),
  );
}

/**
 * The whole decision, offline. Same contract as the remote arbiter.
 *
 * Keeps the remote's bias — when genuinely unsure, interrupt, because talking
 * over someone trying to stop you is worse than pausing by mistake — but only
 * after the two cases where it is *not* unsure: a stop phrase is always the
 * user, and a fragment that is mostly the agent's own words is always echo.
 */
export function localEchoDecision(
  transcript: string,
  agentLine: string,
): ArbiterDecision {
  if (isStopPhrase(transcript)) {
    return { verdict: "interrupt", reason: "stop_phrase" };
  }
  // One stray word off the speakers is the commonest echo there is, and the
  // ones that genuinely mean "stop" were just handled above.
  if (!worthArbitrating(transcript)) {
    return { verdict: "ignore", reason: "too_short" };
  }
  if (echoSimilarity(transcript, agentLine) >= ECHO_SIMILARITY) {
    return { verdict: "ignore", reason: "local_echo" };
  }
  return { verdict: "interrupt", reason: "distinct_utterance" };
}
