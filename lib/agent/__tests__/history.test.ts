import { test } from "node:test";
import assert from "node:assert/strict";

import { restoreHistory } from "../history";
import type { MockMessage } from "@/lib/mock/fixtures";

function msg(overrides: Partial<MockMessage> & { role: MockMessage["role"] }): MockMessage {
  return { id: Math.random().toString(36).slice(2), text: "hello", at: "2026-08-09T10:00:00.000Z", ...overrides };
}

test("a user turn and a reply come back as themselves", () => {
  const restored = restoreHistory([
    msg({ role: "user", text: "what broke?" }),
    msg({ role: "agent", text: "checkout did" }),
  ]);
  assert.deepEqual(restored, [
    { role: "user", content: "what broke?" },
    { role: "assistant", content: [{ type: "text", text: "checkout did" }] },
  ]);
});

test("trace rows are left out", () => {
  // They record tool calls rather than being them: there is no tool_use_id to
  // pair with, and replaying one invites the model to read a summary of past
  // work as a fresh result.
  const restored = restoreHistory([
    msg({ role: "user", text: "open files" }),
    msg({ role: "trace", kind: "TOOL", text: "desktop_act: PLAN COMPLETED." }),
    msg({ role: "agent", text: "Opened it." }),
  ]);
  assert.equal(restored.length, 2);
  assert.ok(!JSON.stringify(restored).includes("PLAN COMPLETED"));
});

test("empty messages are dropped rather than sent as blank turns", () => {
  assert.deepEqual(restoreHistory([msg({ role: "user", text: "   " })]), []);
});

test("a thread that opens with the app speaking still starts on a user turn", () => {
  // Anthropic rejects a conversation whose first message is the assistant's,
  // and the home thread is exactly that shape — the heartbeat got there first.
  const restored = restoreHistory([
    msg({ role: "agent", text: "Checkout is down.", source: "heartbeat", eventRef: "evt-1" }),
    msg({ role: "user", text: "why?" }),
  ]);
  assert.equal(restored[0]?.role, "user", "the first turn must be the user's");
  assert.equal(restored.length, 2);
});

test("what the app said unprompted survives the fold, with its citation", () => {
  // The whole point: dropping these to satisfy the role rule would erase the
  // memory this function exists to restore.
  const restored = restoreHistory([
    msg({ role: "agent", text: "Checkout is down.", source: "heartbeat", eventRef: "evt-1" }),
    msg({ role: "user", text: "why?" }),
  ]);
  const first = restored[0];
  assert.equal(first?.role, "user");
  assert.match(String(first?.content), /Checkout is down/);
  assert.match(String(first?.content), /unprompted/);
});

test("a proactive message mid-conversation is labelled, not passed off as a reply", () => {
  const restored = restoreHistory([
    msg({ role: "user", text: "morning" }),
    msg({ role: "agent", text: "Checkout is down.", source: "heartbeat", eventRef: "evt-9" }),
  ]);
  const spoken = restored[1];
  assert.equal(spoken?.role, "assistant");
  const block = spoken?.role === "assistant" ? spoken.content[0] : undefined;
  const text = block?.type === "text" ? block.text : "";
  assert.match(text, /spoke unprompted/);
  assert.match(text, /evt-9/);
});

test("a very long thread is trimmed from the front", () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    msg({ role: i % 2 === 0 ? "user" : "agent", text: `turn ${i}` }),
  );
  const restored = restoreHistory(many);
  assert.ok(restored.length <= 40);
  assert.equal(restored[0]?.role, "user");
  assert.match(JSON.stringify(restored), /turn 119/, "the most recent turn must survive");
});
