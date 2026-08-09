import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROACTIVE_MIN_GAP_MS,
  canSpeakProactively,
  proactiveMessagesFrom,
  shouldSpeakProactively,
  type ProactiveMessage,
} from "../proactive-speech";
import type { VoiceMode } from "../session";

const HIGH: ProactiveMessage = {
  id: "hb-1",
  text: "The checkout pool is saturating again — same shape as last Tuesday.",
  severity: "high",
};

function context(over: Partial<Parameters<typeof shouldSpeakProactively>[1]> = {}) {
  return { mode: "ambient" as VoiceMode, muted: false, sinceLastMs: null, ...over };
}

test("a high finding is said into an open, quiet session", () => {
  assert.equal(shouldSpeakProactively(HIGH, context()), true);
});

test("nothing is said when no voice session is open", () => {
  // A desktop with voice off has not asked to be spoken to. This is the gate
  // that stops the app becoming a machine that talks to an empty room.
  assert.equal(shouldSpeakProactively(HIGH, context({ mode: "idle" })), false);
});

test("a muted microphone is someone asking for quiet", () => {
  assert.equal(shouldSpeakProactively(HIGH, context({ muted: true })), false);
});

test("the agent does not talk over itself or over you", () => {
  for (const mode of ["speaking", "thinking", "confirming", "awake"] as const) {
    assert.equal(
      shouldSpeakProactively(HIGH, context({ mode })),
      false,
      `must stay quiet while ${mode}`,
    );
  }
});

test("awake is excluded because the user has the floor", () => {
  // Distinct from the others: `awake` means they just summoned it and are about
  // to speak, which is the worst possible moment to volunteer something.
  assert.equal(canSpeakProactively("awake", false), false);
  assert.equal(canSpeakProactively("ambient", false), true);
});

test("only what is worth interrupting for", () => {
  for (const severity of ["medium", "low", undefined] as const) {
    assert.equal(
      shouldSpeakProactively({ ...HIGH, severity }, context()),
      false,
      `${severity} belongs in the activity list, not out loud`,
    );
  }
  assert.equal(shouldSpeakProactively({ ...HIGH, severity: "critical" }, context()), true);
});

test("a rate limit keeps the loop from becoming a monologue", () => {
  assert.equal(
    shouldSpeakProactively(HIGH, context({ sinceLastMs: PROACTIVE_MIN_GAP_MS - 1 })),
    false,
  );
  assert.equal(
    shouldSpeakProactively(HIGH, context({ sinceLastMs: PROACTIVE_MIN_GAP_MS })),
    true,
  );
});

test("a message with nothing sayable in it is not spoken", () => {
  // It would be an empty utterance that still burned the rate limit.
  const codeOnly: ProactiveMessage = { id: "hb-2", text: "   ", severity: "critical" };
  assert.equal(shouldSpeakProactively(codeOnly, context()), false);
});

/* -------------------------------------------------------------------------- */
/* Reading the home conversation                                               */
/* -------------------------------------------------------------------------- */

const PAYLOAD = {
  id: "home",
  messages: [
    { id: "u-1", role: "user", text: "what is up", at: "2026-08-09T10:00:00.000Z" },
    {
      id: "hb-b",
      role: "agent",
      source: "heartbeat",
      severity: "high",
      text: "Second wake-up.",
      at: "2026-08-09T12:00:00.000Z",
    },
    {
      id: "a-1",
      role: "agent",
      text: "An ordinary reply to a question you asked.",
      at: "2026-08-09T11:00:00.000Z",
    },
    {
      id: "hb-a",
      role: "agent",
      source: "heartbeat",
      severity: "critical",
      text: "First wake-up.",
      at: "2026-08-09T09:00:00.000Z",
    },
  ],
};

test("only the loop's own messages are candidates", () => {
  // An answer to a question the user asked was already spoken when it was
  // given; saying it again unprompted would be the agent repeating itself.
  const found = proactiveMessagesFrom(PAYLOAD);
  assert.deepEqual(
    found.map((message) => message.id),
    ["hb-a", "hb-b"],
  );
});

test("candidates come back oldest first, so the newest stamp is the watermark", () => {
  const found = proactiveMessagesFrom(PAYLOAD);
  assert.equal(found.at(-1)?.at, "2026-08-09T12:00:00.000Z");
});

test("severity survives the trip", () => {
  const found = proactiveMessagesFrom(PAYLOAD);
  assert.equal(found[0].severity, "critical");
  assert.equal(found[1].severity, "high");
});

test("an unknown severity is absent rather than guessed", () => {
  const found = proactiveMessagesFrom({
    messages: [
      { id: "hb-x", role: "agent", source: "heartbeat", severity: "urgent", text: "hi", at: "2026-08-09T09:00:00.000Z" },
    ],
  });
  assert.equal(found[0].severity, undefined);
  // And absent means it never clears the floor.
  assert.equal(shouldSpeakProactively(found[0], context()), false);
});

test("malformed payloads yield nothing rather than throwing", () => {
  for (const payload of [null, undefined, {}, { messages: "nope" }, { messages: [null, 3] }]) {
    assert.deepEqual(proactiveMessagesFrom(payload), []);
  }
});

test("a message missing its stamp is skipped", () => {
  // The watermark is the timestamp; a message without one could be replayed on
  // every poll forever.
  const found = proactiveMessagesFrom({
    messages: [{ id: "hb-y", role: "agent", source: "heartbeat", text: "no stamp" }],
  });
  assert.deepEqual(found, []);
});
