/**
 * Detecting "hey SOS" in a live transcript.
 */

const NAME = String.raw`(?:s\s*\.?\s*o\s*\.?\s*s|sos|soss|sauce|source|s\.o\.s\.?)`;
const GREETING = String.raw`(?:hey|hi|hello|ok|okay|yo)`;

const WAKE_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b${GREETING}\s+${NAME}\b`, "i"),
  new RegExp(
    String.raw`\b${NAME}[,.\s]+(?:are\s+you\s+(?:there|here)|wake\s+up|listen)\b`,
    "i",
  ),
  new RegExp(String.raw`^\s*${NAME}\b[,.]?\s`, "i"),
];

export interface WakeMatch {
  start: number;
  end: number;
  phrase: string;
  rest: string;
}

export function detectWakeWord(text: string): WakeMatch | null {
  if (!text) return null;

  for (const pattern of WAKE_PATTERNS) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const end = match.index + match[0].length;
      return {
        start: match.index,
        end,
        phrase: match[0].trim(),
        rest: text
          .slice(end)
          .replace(/^[\s,.?!:;\-\u2013\u2014]+/, "")
          .trim(),
      };
    }
  }
  return null;
}
