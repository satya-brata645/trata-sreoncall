import { test } from "node:test";
import assert from "node:assert/strict";

import { detectWakeWord } from "../wakeWord";
import { MAX_CONSENT_WORDS, parseConsent, promptIsEchoSafe } from "../consent";

/**
 * Both modules were only ever reached indirectly, as dependencies handed to a
 * `VoiceSession`, so nothing asserted what they actually recognise. They are the
 * two places a mis-hearing turns into an action: one opens the microphone's
 * attention, the other approves a change to the user's desktop.
 */

/* -------------------------------------------------------------------------- */
/* The wake word                                                               */
/* -------------------------------------------------------------------------- */

test("the plain greeting wakes it", () => {
  for (const said of ["hey SOS", "hi sos", "hello S.O.S.", "ok sos", "yo sos"]) {
    assert.notEqual(detectWakeWord(said), null, said);
  }
});

test("the ways recognition mangles the name still wake it", () => {
  // Speech recognition has no idea "SOS" is a name. These are what it actually
  // returns, and refusing them would mean a wake word that works for nobody.
  for (const said of ["hey sauce", "hey source", "hey soss", "hey s o s"]) {
    assert.notEqual(detectWakeWord(said), null, said);
  }
});

test("the instruction after the phrase comes back with it", () => {
  // A wake and an instruction in one breath is the common case; dropping the
  // rest would make the user say it twice.
  const match = detectWakeWord("hey SOS, open the reachability report");
  assert.equal(match?.rest, "open the reachability report");
});

test("a bare wake carries no instruction", () => {
  assert.equal(detectWakeWord("hey SOS")?.rest, "");
});

test("the name at the head of a sentence wakes it", () => {
  assert.equal(detectWakeWord("SOS, what is exposed")?.rest, "what is exposed");
});

test("asking whether it is there wakes it", () => {
  for (const said of ["sos are you there", "sos wake up", "sos listen"]) {
    assert.notEqual(detectWakeWord(said), null, said);
  }
});

test("ordinary speech does not wake it", () => {
  // The cost of a false wake is the microphone starting to take instructions
  // from a conversation that was not with it.
  for (const said of [
    "",
    "the sauce for the pasta",
    "let me check the source of that",
    "so someone should look at it",
    "we should close the incident",
  ]) {
    assert.equal(detectWakeWord(said), null, said);
  }
});

test("the match reports where the phrase was", () => {
  const match = detectWakeWord("okay so, hey SOS open chat");
  assert.ok(match);
  assert.equal(match.phrase.toLowerCase().includes("sos"), true);
  assert.ok(match.start > 0, "it found the phrase mid-sentence");
});

/* -------------------------------------------------------------------------- */
/* Consent                                                                     */
/* -------------------------------------------------------------------------- */

test("the ordinary yeses are read as yes", () => {
  for (const said of ["yes", "yeah", "yep", "sure", "do it", "go ahead", "please do"]) {
    assert.equal(parseConsent(said), "yes", said);
  }
});

test("the ordinary noes are read as no", () => {
  for (const said of ["no", "nope", "nah", "cancel", "stop", "not now", "never mind"]) {
    assert.equal(parseConsent(said), "no", said);
  }
});

test("no wins over yes in the same breath", () => {
  // "yes, no, wait" is someone changing their mind. Refusing is the safe read.
  assert.equal(parseConsent("yes no"), "no");
});

test("anything long is unclear, however it starts", () => {
  // A sentence containing "yes" is not an approval — it is a conversation, and
  // treating it as consent is how an agent talks someone into a change.
  const said = "yes but only if it does not close the other window";
  assert.ok(said.split(" ").length > MAX_CONSENT_WORDS);
  assert.equal(parseConsent(said), "unclear");
});

test("silence and noise are unclear, never consent", () => {
  for (const said of ["", "   ", "hmm", "what", null, undefined]) {
    assert.equal(parseConsent(said), "unclear", String(said));
  }
});

test("punctuation and case do not change the reading", () => {
  assert.equal(parseConsent("Yes!"), "yes");
  assert.equal(parseConsent("  NO. "), "no");
});

test("a word merely containing yes is not yes", () => {
  assert.equal(parseConsent("yesterday"), "unclear");
});

/* -------------------------------------------------------------------------- */
/* Echo safety                                                                 */
/* -------------------------------------------------------------------------- */

test("a prompt containing a consent word is refused", () => {
  // The microphone hears the agent's own voice; a question with "go ahead" in
  // it is a question that can answer itself.
  assert.equal(promptIsEchoSafe("Go ahead and open Launchpad?"), false);
  assert.equal(promptIsEchoSafe("Shall I close it, or leave it?"), false);
});

test("an ordinary question is safe to ask", () => {
  assert.equal(promptIsEchoSafe("Open Launchpad and move Chat to the right half. Shall I?"), true);
});

test("every phrase the parser accepts is one the prompt may not contain", () => {
  // The two lists have to stay in step: a word the parser reads as consent but
  // the guard permits in a prompt is exactly the echo hole this closes.
  for (const said of ["yes", "no", "do it", "go ahead", "cancel", "never mind"]) {
    assert.notEqual(parseConsent(said), "unclear", said);
    assert.equal(promptIsEchoSafe(`Something ${said} something.`), false, said);
  }
});
