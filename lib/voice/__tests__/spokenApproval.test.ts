import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  NEUTRAL_APPROVAL_PROMPT,
  denyPendingApprovalByVoice,
  offerApprovalByVoice,
  resetSpokenApprovalForTests,
  safeSpokenPrompt,
  withdrawApprovalByVoice,
} from "../spoken-approval";
import {
  getPendingApproval,
  resetPendingApprovalForTests,
  setPendingApproval,
} from "../pending-approval";
import { parseConsent, promptIsEchoSafe } from "../consent";
import { spokenApprovalPrompt } from "@/lib/agent/desktop-plan-copy";

function harness() {
  const spoken: string[] = [];
  const answers: boolean[] = [];
  let stops = 0;
  return {
    spoken,
    answers,
    stops: () => stops,
    offer: (id: string, line: string) =>
      offerApprovalByVoice({
        id,
        spoken: line,
        respond: (approved) => answers.push(approved),
        speak: (text) => spoken.push(text),
        stopSpeaking: () => {
          stops += 1;
        },
      }),
  };
}

beforeEach(() => {
  resetSpokenApprovalForTests();
  resetPendingApprovalForTests();
});

test("offering opens the store the voice session watches", () => {
  // Before this producer existed the store was never written, so the session's
  // `confirming` mode could not be reached and saying yes approved nothing.
  const h = harness();
  h.offer("a1", "Open Launchpad. Shall I?");

  const pending = getPendingApproval();
  assert.ok(pending, "a decision is outstanding");
  assert.equal(pending.id, "a1");
  assert.deepEqual(h.spoken, ["Open Launchpad. Shall I?"]);
});

test("answering clears the store", () => {
  // The session leaves `confirming` when the store empties. A responder that
  // only answered would leave the microphone waiting on a settled question.
  const h = harness();
  h.offer("a1", "Open Launchpad. Shall I?");
  getPendingApproval()?.respond(true);

  assert.deepEqual(h.answers, [true]);
  assert.equal(getPendingApproval(), null);
});

test("answering twice answers once", () => {
  const h = harness();
  h.offer("a1", "Open Launchpad. Shall I?");
  const pending = getPendingApproval();
  pending?.respond(true);
  pending?.respond(false);
  assert.deepEqual(h.answers, [true]);
});

test("answering stops the agent mid-question", () => {
  const h = harness();
  h.offer("a1", "Open Launchpad, and move Chat to the right half. Shall I?");
  getPendingApproval()?.respond(true);
  assert.equal(h.stops(), 1);
});

test("a superseded question is denied, not dropped", () => {
  // Two outstanding decisions must never both be answerable by one "yes".
  const h = harness();
  h.offer("a1", "Open Launchpad. Shall I?");
  h.offer("a2", "Close Files. Shall I?");

  assert.deepEqual(h.answers, [false], "the first fails closed");
  assert.equal(getPendingApproval()?.id, "a2");
});

test("withdrawing settles without answering", () => {
  // The card was clicked; the question is over but the voice did not decide it.
  const h = harness();
  h.offer("a1", "Open Launchpad. Shall I?");
  withdrawApprovalByVoice("a1");

  assert.deepEqual(h.answers, []);
  assert.equal(getPendingApproval(), null);
});

test("withdrawing the wrong id leaves the live question alone", () => {
  const h = harness();
  h.offer("a1", "Open Launchpad. Shall I?");
  withdrawApprovalByVoice("stale");
  assert.equal(getPendingApproval()?.id, "a1");
});

test("denying is the fail-closed exit", () => {
  const h = harness();
  h.offer("a1", "Open Launchpad. Shall I?");
  denyPendingApprovalByVoice();

  assert.deepEqual(h.answers, [false]);
  assert.equal(getPendingApproval(), null);
});

test("denying a question this module did not ask still settles it", () => {
  const answers: boolean[] = [];
  // A responder written elsewhere may not know to clear the store; leaving it
  // populated would strand the session in `confirming` forever.
  setPendingApproval({ id: "foreign", spoken: "Shall I?", respond: (ok) => answers.push(ok) });

  denyPendingApprovalByVoice();
  assert.deepEqual(answers, [false]);
  assert.equal(getPendingApproval(), null);
});

test("denying with nothing outstanding is a no-op", () => {
  assert.doesNotThrow(() => denyPendingApprovalByVoice());
  assert.equal(getPendingApproval(), null);
});

/* -------------------------------------------------------------------------- */
/* Echo safety                                                                 */
/* -------------------------------------------------------------------------- */

test("a question containing its own answer is not asked", () => {
  // The microphone hears the agent's own voice, and `parseConsent` cannot tell
  // whose "go ahead" it was — so this prompt would approve itself.
  const unsafe = "Go ahead and open Launchpad. Shall I?";
  assert.equal(safeSpokenPrompt(unsafe), NEUTRAL_APPROVAL_PROMPT);
});

test("a plan step that happens to say stop is not asked either", () => {
  assert.equal(
    safeSpokenPrompt("Set Monitor's filter to \"stop\". Shall I?"),
    NEUTRAL_APPROVAL_PROMPT,
  );
});

test("the neutral fallback contains no consent word", () => {
  // Asserted rather than trusted: the fallback is the last line of defence, so
  // an edit that made it echo-unsafe must fail here.
  assert.ok(promptIsEchoSafe(NEUTRAL_APPROVAL_PROMPT));
  assert.equal(parseConsent(NEUTRAL_APPROVAL_PROMPT), "unclear");
});

test("an ordinary plan is asked as written", () => {
  const line = "Open Launchpad, and move Chat to the right half. Shall I?";
  assert.equal(safeSpokenPrompt(line), line);
});

test("an empty question falls back rather than speaking silence", () => {
  assert.equal(safeSpokenPrompt("   "), NEUTRAL_APPROVAL_PROMPT);
});

test("the prompt the desktop actually builds is echo-safe", () => {
  // `spokenApprovalPrompt` is what the approval call site will hand over, so
  // its typical output must survive the guard rather than always falling back.
  const line = spokenApprovalPrompt({
    intent: "put the report next to the matrix",
    steps: [
      { verb: "open_app", appId: "security" },
      { verb: "snap", handle: 2, preset: "right-half", title: "CVE matrix" },
    ],
  });
  assert.ok(promptIsEchoSafe(line), line);
  assert.equal(safeSpokenPrompt(line), line);
});

/* -------------------------------------------------------------------------- */
/* The answer the session will hand back                                       */
/* -------------------------------------------------------------------------- */

test("spoken yes and no reach the responder", () => {
  for (const [said, expected] of [
    ["yes", true],
    ["yeah do it", true],
    ["no", false],
    ["nope", false],
  ] as const) {
    resetSpokenApprovalForTests();
    resetPendingApprovalForTests();
    const h = harness();
    h.offer("a1", "Open Launchpad. Shall I?");

    const verdict = parseConsent(said);
    assert.notEqual(verdict, "unclear", said);
    getPendingApproval()?.respond(verdict === "yes");
    assert.deepEqual(h.answers, [expected], said);
  }
});

test("an unclear answer leaves the question standing", () => {
  const h = harness();
  h.offer("a1", "Open Launchpad. Shall I?");
  assert.equal(parseConsent("what does that do"), "unclear");
  // Nothing responded, so the decision is still outstanding and the session
  // stays in `confirming` rather than guessing.
  assert.equal(getPendingApproval()?.id, "a1");
  assert.deepEqual(h.answers, []);
});
