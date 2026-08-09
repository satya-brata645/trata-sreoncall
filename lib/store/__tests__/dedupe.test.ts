import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The dedupe rule, tested against the shape rather than the filesystem.
 *
 * Both logs collapse repeated ids the same way and it is load-bearing in both:
 * a producer retrying a POST and a heartbeat replaying a beat must each be a
 * no-op. The rule is *first occurrence wins*, and the reason is the bug it
 * replaced — last-wins let a retry overwrite the original with a fresh server
 * timestamp and whatever fields the producer happened to resend, so a replay
 * moved an incident's start time forward and dropped its action items.
 *
 * Kept as a pure reduction so it can be asserted without touching disk; the
 * stores run exactly this loop.
 */
function collapse<T extends { id: string }>(lines: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of lines) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

test("a replayed record is ignored, not applied", () => {
  const original = { id: "evt-1", at: "2026-08-09T10:00:00.000Z", actionItems: ["Roll back"] };
  const replay = { id: "evt-1", at: "2026-08-09T10:13:00.000Z", actionItems: [] };

  const [kept] = collapse([original, replay]);
  assert.equal(kept?.at, original.at, "the original timestamp must survive a retry");
  assert.deepEqual(kept?.actionItems, ["Roll back"], "a thinner retry must not erase fields");
});

test("distinct ids all survive", () => {
  const collapsed = collapse([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }]);
  assert.deepEqual(collapsed.map((item) => item.id), ["a", "b", "c"]);
});

test("order of first appearance is preserved", () => {
  // The stores sort by `at` afterwards, but a stable base ordering is what
  // makes the sort's tiebreak deterministic between reads.
  const collapsed = collapse([{ id: "c" }, { id: "a" }, { id: "b" }]);
  assert.deepEqual(collapsed.map((item) => item.id), ["c", "a", "b"]);
});
