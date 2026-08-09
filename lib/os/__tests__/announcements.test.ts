import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANNOUNCEMENT_LINGER_MS,
  announceAction,
  clearAnnouncements,
  getAnnouncement,
  resetAnnouncementsForTests,
  subscribeAnnouncements,
} from "../announcements";

/**
 * `UX-21` is a MUST and it failed for the whole of Part I and Part II: the
 * desktop had exactly two live regions — the status chip and the command bar
 * narration — and no window move reached either.
 *
 * These pin the pieces that make a live region actually speak. They are not
 * obvious, and they are why this feature so often ships looking correct and
 * doing nothing.
 */

test.beforeEach(() => resetAnnouncementsForTests());

test("announcing publishes the message", () => {
  announceAction("Moved Pentest to the left half.");
  assert.equal(getAnnouncement().message, "Moved Pentest to the left half.");
});

test("a repeated action still bumps the sequence", () => {
  // THE SUBTLE ONE. Two identical moves produce the same string, and a live
  // region whose text has not changed is not re-read — so the second move
  // would be silent. The counter is what forces the re-announcement, and the
  // component keys on it for exactly this reason.
  announceAction("Moved Pentest to the left half.");
  const first = getAnnouncement().seq;
  announceAction("Moved Pentest to the left half.");
  assert.equal(
    getAnnouncement().seq,
    first + 1,
    "an identical repeat must still announce",
  );
});

test("blank outcomes are not announced", () => {
  announceAction("Moved Pentest.");
  const before = getAnnouncement().seq;
  announceAction("");
  announceAction("   ");
  assert.equal(getAnnouncement().seq, before);
});

test("clearing empties the region", () => {
  announceAction("Moved Pentest.");
  clearAnnouncements();
  assert.equal(getAnnouncement().message, "");
});

test("clearing twice is a no-op", () => {
  clearAnnouncements();
  clearAnnouncements();
  assert.equal(getAnnouncement().message, "");
});

test("subscribers are notified on announce and on clear", () => {
  let calls = 0;
  const unsubscribe = subscribeAnnouncements(() => calls++);
  announceAction("Opened Brain.");
  assert.equal(calls, 1);
  clearAnnouncements();
  assert.equal(calls, 2);
  unsubscribe();
});

test("the linger is long enough to finish a sentence, short enough to expire", () => {
  // Clearing the instant a run ends cuts the reader off mid-word; never
  // clearing leaves a ten-minute-old window move to be re-read as if it had
  // just happened.
  assert.ok(ANNOUNCEMENT_LINGER_MS >= 2000);
  assert.ok(ANNOUNCEMENT_LINGER_MS <= 10000);
});
