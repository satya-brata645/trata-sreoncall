"use client";

/**
 * Letting the agent look up what it was told.
 *
 * Without this the product's central claim does not survive one follow-up
 * question. It speaks first, citing an event id — and then "why did you tell me
 * that?" has nothing behind it, because the event log was something the
 * heartbeat read and the chat could not. The agent went and read the *desktop*
 * instead, which is the wrong shelf.
 *
 * Read-only and available in every mode, `self` included: looking something up
 * is not desktop control, and an agent that cannot check its own claims while
 * the user is questioning them is worse than useless at exactly the moment it
 * matters most.
 */

import { fenceWithNotice } from "./untrusted-content";
import type { SreEvent } from "./events";

export const DATA_TOOLS = new Set(["read_events"]);

export function isDataTool(toolName: string): boolean {
  return DATA_TOOLS.has(toolName);
}

/** Compact text, not JSON — it is read far more often than it is parsed. */
function renderEvent(event: SreEvent): string {
  const lines = [`[${event.severity}] ${event.kind} — ${event.headline}`, `  id: ${event.id}`];
  if (event.incidentId) lines.push(`  incident: ${event.incidentId}`);
  if (event.confidence !== undefined) lines.push(`  confidence: ${event.confidence}`);
  if (event.summary) lines.push(`  ${event.summary}`);
  if (event.actionItems.length > 0) lines.push(`  next: ${event.actionItems.join("; ")}`);
  if (event.evidence.length > 0) {
    lines.push(
      `  evidence: ${event.evidence
        .map((item) => `${item.kind}:${item.ref}${item.label ? ` (${item.label})` : ""}`)
        .join(", ")}`,
    );
  }
  lines.push(`  at: ${event.at} · from: ${event.source}`);
  return lines.join("\n");
}

export async function handleDataToolCall(
  toolName: string,
  input: unknown,
): Promise<string | null> {
  if (!isDataTool(toolName)) return null;

  try {
    const response = await fetch("/api/events");
    if (!response.ok) return "The event log could not be read just now.";
    const body = (await response.json()) as { events?: SreEvent[] };
    let events = Array.isArray(body.events) ? body.events : [];

    const incidentId = (input as { incidentId?: unknown } | null)?.incidentId;
    if (typeof incidentId === "string" && incidentId.trim()) {
      events = events.filter((event) => event.incidentId === incidentId);
    }

    if (events.length === 0) {
      // Said plainly, because "nothing has been reported" is a real answer and
      // an agent that treats it as an error will start guessing instead.
      return "The SRE agent has not reported anything matching that. Say so rather than guessing.";
    }

    // Fenced like any other content this side did not author: an event's
    // headline is text written by another system, and one of the things that
    // system reports on is attackers.
    return fenceWithNotice(
      events.slice(0, 25).map(renderEvent).join("\n\n"),
      "third-party content",
    );
  } catch {
    return "The event log could not be reached from here.";
  }
}
