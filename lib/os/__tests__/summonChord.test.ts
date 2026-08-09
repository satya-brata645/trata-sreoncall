import { test } from "node:test";
import assert from "node:assert/strict";

import { isSummonChord } from "../AgentSummonContext";

const base = { altKey: false, ctrlKey: false, metaKey: false };

test("⌥Space is the summon chord", () => {
  assert.equal(isSummonChord({ ...base, altKey: true, code: "Space" }), true);
});

test("Option+Space is matched on `code`, not on the character it produces", () => {
  // macOS turns Option+Space into a non-breaking space, so a handler matching
  // `key === " "` would silently never fire. This is the bug that check exists
  // to prevent.
  assert.equal(
    isSummonChord({ ...base, altKey: true, code: "Space", key: " " }),
    true,
  );
});

test("Space on its own is not the chord", () => {
  // Otherwise typing a space anywhere on the desktop would summon the agent.
  assert.equal(isSummonChord({ ...base, code: "Space" }), false);
});

test("adding another modifier is a different chord", () => {
  // ⌘⌥Space and ⌃⌥Space belong to the OS and to other apps; claiming them
  // would break bindings the user already has.
  assert.equal(
    isSummonChord({ ...base, altKey: true, metaKey: true, code: "Space" }),
    false,
  );
  assert.equal(
    isSummonChord({ ...base, altKey: true, ctrlKey: true, code: "Space" }),
    false,
  );
});

test("⌥ with any other key is not the chord", () => {
  assert.equal(isSummonChord({ ...base, altKey: true, code: "KeyK" }), false);
});
