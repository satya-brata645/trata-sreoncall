/**
 * Saying yes out loud.
 *
 * This is intentionally a keyword matcher, not a model call: latency matters,
 * ambiguity is not consent, and the prompt the agent speaks must never contain
 * approval words that would let it approve itself by echo.
 */

export type ConsentVerdict = "yes" | "no" | "unclear";

const YES = [
  "yes",
  "yeah",
  "yep",
  "yup",
  "sure",
  "do it",
  "go ahead",
  "go for it",
  "please do",
  "okay do it",
];

const NO = [
  "no",
  "nope",
  "nah",
  "don't",
  "do not",
  "stop",
  "cancel",
  "not now",
  "never mind",
  "nevermind",
  "leave it",
  "forget it",
];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}($|\\s)`).test(haystack);
}

export const MAX_CONSENT_WORDS = 4;

export function parseConsent(text: string | null | undefined): ConsentVerdict {
  if (!text) return "unclear";
  const normalised = normalise(text);
  if (!normalised) return "unclear";
  if (normalised.split(" ").length > MAX_CONSENT_WORDS) return "unclear";

  if (NO.some((phrase) => containsPhrase(normalised, phrase))) return "no";
  if (YES.some((phrase) => containsPhrase(normalised, phrase))) return "yes";
  return "unclear";
}

export function promptIsEchoSafe(prompt: string): boolean {
  const normalised = normalise(prompt);
  return ![...YES, ...NO].some((phrase) =>
    containsPhrase(normalised, phrase),
  );
}
