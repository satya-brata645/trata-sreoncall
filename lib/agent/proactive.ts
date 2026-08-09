/**
 * The proactive brain's contract.
 *
 * The full product asks a model whether a background change is worth surfacing.
 * This fixture build does not ship that backend path, but the decision shape
 * still belongs in one place so the local heartbeat and a future server route
 * speak the same language.
 */

export const PROACTIVE_SYSTEM = [
  "You are the same teammate the user works with in chat on Transilience AI.",
  "When you reach out unprompted, send one short message in a human voice.",
  "Speak only when something genuinely matters or is clearly useful now.",
  'Reply with JSON only: {"speak": true, "message": "..."} or {"speak": false, "message": ""}.',
].join("\n");

export interface ProactiveDecision {
  speak: boolean;
  message: string;
}

export function parseDecision(text: string): ProactiveDecision {
  const silent: ProactiveDecision = { speak: false, message: "" };
  if (!text) return silent;
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }
    const parsed = JSON.parse(cleaned) as { speak?: unknown; message?: unknown };
    const speak = parsed.speak === true;
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    return speak && message ? { speak: true, message } : silent;
  } catch {
    return silent;
  }
}
