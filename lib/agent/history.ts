/**
 * Giving the agent back what it said.
 *
 * The transcript and the model's memory are two different things, and only one
 * of them was durable. Messages persisted, so a reload showed the whole
 * conversation — and then the first follow-up went to a model that had never
 * seen any of it, because history lived in a `useRef` that started empty on
 * every mount. The conversation looked continuous and was not.
 *
 * The heartbeat makes this worse in a way that is easy to miss: the app speaks
 * first, on its own, and that message is written by a process the browser had
 * no part in. Without this, asking "what did you just tell me?" reaches a model
 * with no record of having told you anything.
 *
 * Pure, so it can be tested without a browser or a store.
 */

import type { LiveAgentMessage } from "./live-protocol";
import type { MockMessage } from "@/lib/mock/fixtures";

/**
 * How much of the past to hand back.
 *
 * The route trims to its own limit anyway; this one exists so a long-lived
 * thread does not grow the client's working set without bound. Recent turns are
 * what a follow-up refers to.
 */
const MAX_RESTORED = 40;

export function restoreHistory(messages: readonly MockMessage[]): LiveAgentMessage[] {
  const restored: LiveAgentMessage[] = [];

  for (const message of messages.slice(-MAX_RESTORED)) {
    // Trace rows are the *record* of tool calls, not the calls themselves —
    // they have no `tool_use_id` to pair with, and replaying them as content
    // would invite the model to treat a summary of past work as a fresh result.
    if (message.role === "trace") continue;
    if (!message.text.trim()) continue;

    if (message.role === "user") {
      restored.push({ role: "user", content: message.text });
      continue;
    }

    // Proactive messages are labelled rather than replayed bare. The model is
    // being reminded it spoke unprompted, which is not the same as having been
    // asked something — and without the label it reads its own heartbeat line
    // as a reply to a question nobody asked.
    const text =
      message.source === "heartbeat"
        ? `(spoke unprompted${message.eventRef ? `, about ${message.eventRef}` : ""}) ${message.text}`
        : message.text;

    restored.push({ role: "assistant", content: [{ type: "text", text }] });
  }

  // Anthropic rejects a conversation that opens on an assistant turn — and a
  // thread the app started by speaking first is exactly that shape.
  //
  // Dropping those would erase the memory this function exists to restore: the
  // home thread often opens with nothing *but* heartbeat messages. So they are
  // folded into one user-role block instead, labelled as a transcript. That is
  // the same transport tool results already use — the `user` role here carries
  // context from the environment, not words put in anyone's mouth.
  const leading: string[] = [];
  while (restored.length > 0 && restored[0]!.role !== "user") {
    const [first] = restored.splice(0, 1);
    if (first?.role === "assistant") {
      leading.push(first.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
    }
  }

  if (leading.length > 0) {
    restored.unshift({
      role: "user",
      content: [
        "Context — what you had already said in this conversation before now, unprompted:",
        "",
        ...leading,
      ].join("\n"),
    });
  }

  return restored;
}
