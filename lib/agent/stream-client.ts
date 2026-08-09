"use client";

/**
 * Reading a turn as it is written.
 *
 * The route answers with SSE and a 200 before it knows whether the turn will
 * succeed, so a failure arrives as an `error` frame rather than a status code —
 * which means the one thing this must not do is treat "the response was ok" as
 * "the turn worked". It throws on an error frame, and it throws if the stream
 * ends without a `done`, because a truncated turn that resolved would leave the
 * caller pushing an empty assistant message into history and confusing the
 * model on the next request.
 */

import type { LiveAgentFrame, LiveAgentMessage, LiveAgentResponse } from "./live-protocol";

export interface StreamHandlers {
  onDelta: (accumulated: string) => void;
  /** The light lane withdrew what it said and handed the turn over. */
  onDiscard: () => void;
}

export async function streamAgentTurn(
  body: { messages: LiveAgentMessage[]; voice: boolean; agentMode: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<LiveAgentResponse> {
  const request = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Without this, closing the chat window leaves the turn running against a
    // component that will never render its answer — tokens spent on a reply
    // nobody can receive.
    signal,
  });

  // A failure before the stream opens is still an ordinary JSON error.
  if (!request.ok || !request.body) {
    const payload = await request.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Agent request failed (${request.status})`);
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let done: LiveAgentResponse | null = null;

  while (true) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    // The tail is a partial frame; it waits for the next chunk.
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((candidate) => candidate.startsWith("data:"));
      if (!line) continue;

      let parsed: LiveAgentFrame;
      try {
        parsed = JSON.parse(line.slice(5).trim()) as LiveAgentFrame;
      } catch {
        continue;
      }

      if (parsed.type === "text_delta") {
        accumulated += parsed.text;
        handlers.onDelta(accumulated);
      } else if (parsed.type === "discard") {
        accumulated = "";
        handlers.onDiscard();
      } else if (parsed.type === "error") {
        throw new Error(parsed.error);
      } else if (parsed.type === "done") {
        done = parsed.response;
      }
    }
  }

  if (!done) throw new Error("The agent stream ended before the turn finished.");
  return done;
}
