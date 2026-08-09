import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { chunkForSpeech, speakBrowserText, stopBrowserSpeech } from "../browser-playback";
import { getAgentSpeech } from "../agent-speech";

/**
 * The engine, faked.
 *
 * `browser-playback` reads `window.speechSynthesis` at call time, so a fake on
 * `globalThis` is enough to drive the real queue, watchdogs and speech state
 * without a browser.
 */
class FakeUtterance {
  text: string;
  voice: unknown = null;
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class FakeSynthesis {
  spoken: FakeUtterance[] = [];
  cancels = 0;
  pauses = 0;
  resumes = 0;
  speaking = false;
  paused = false;
  /** When set, an utterance is accepted and then never reports anything. */
  swallow = false;

  speak(utterance: FakeUtterance) {
    this.spoken.push(utterance);
    this.speaking = true;
    if (this.swallow) return;
    utterance.onstart?.();
  }
  cancel() {
    this.cancels += 1;
    this.speaking = false;
  }
  pause() {
    this.pauses += 1;
    this.paused = true;
  }
  resume() {
    this.resumes += 1;
    this.paused = false;
  }
  getVoices() {
    return [];
  }

  /** Finish the utterance the engine is currently on. */
  finishCurrent() {
    const current = this.spoken.at(-1);
    this.speaking = false;
    current?.onend?.();
  }
}

const globals = globalThis as Record<string, unknown>;
let engine = new FakeSynthesis();

// Only ever read at call time — `browser-playback` skips its module-load
// registration when there is no window, which is exactly the case here, and
// nothing under test needs the registered control.
globals.window = { speechSynthesis: engine };
globals.SpeechSynthesisUtterance = FakeUtterance;

/** speakBrowserText defers its first chunk by a tick, off the cancel. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/**
 * An answer long enough to be split.
 *
 * Short answers are deliberately kept as one utterance, so a multi-chunk test
 * needs text that genuinely passes the limit rather than two short sentences.
 */
const LONG_ANSWER = [
  "Three of the eleven advisories reach production code paths, and two of those are on the checkout service.",
  "The other eight are transitive and unreachable from any entry point I can see from here.",
  "I have put the reachability report next to the CVE matrix so you can compare them directly.",
].join(" ");

beforeEach(() => {
  engine = new FakeSynthesis();
  (globals.window as { speechSynthesis: FakeSynthesis }).speechSynthesis = engine;
  stopBrowserSpeech();
});

afterEach(() => {
  stopBrowserSpeech();
});

test("an answer is spoken as words, not as markdown", async () => {
  speakBrowserText("**Done.** I opened `Launchpad`. See [the report](https://x.test/r).");
  await tick();

  assert.equal(engine.spoken.length, 1);
  assert.equal(engine.spoken[0].text, "Done. I opened Launchpad. See the report.");
});

test("a long answer is queued in pieces rather than one utterance", async () => {
  // A single long utterance hits Chromium's mid-sentence stall and is cut off.
  assert.ok(chunkForSpeech(LONG_ANSWER).length > 1, "the fixture is long enough");

  speakBrowserText(LONG_ANSWER);
  await tick();

  assert.equal(engine.spoken.length, 1, "one at a time, not all at once");
  engine.finishCurrent();
  assert.equal(engine.spoken.length, 2, "the next follows on end");
});

test("a short answer stays a single utterance", async () => {
  speakBrowserText("Done.");
  await tick();
  assert.equal(engine.spoken.length, 1);
  engine.finishCurrent();
  assert.equal(engine.spoken.length, 1, "nothing queued behind it");
  assert.equal(getAgentSpeech().speaking, false);
});

test("the queue drains and reports the agent as silent", async () => {
  // The voice session leaves `speaking` when playback drains; an utterance that
  // never reports finishing hangs the whole machine.
  speakBrowserText(LONG_ANSWER);
  await tick();
  assert.equal(getAgentSpeech().speaking, true);

  while (engine.speaking) engine.finishCurrent();

  assert.equal(getAgentSpeech().speaking, false);
  assert.equal(getAgentSpeech().line, "");
});

test("the line being spoken is published per chunk", async () => {
  speakBrowserText(LONG_ANSWER);
  await tick();
  const first = getAgentSpeech().line;

  engine.finishCurrent();
  assert.equal(getAgentSpeech().speaking, true, "still talking between chunks");
  assert.notEqual(getAgentSpeech().line, first, "the narration follows the voice");
});

test("cancelling is a stop, never the prelude to a speak", async () => {
  // `cancel()` immediately followed by `speak()` intermittently kills the
  // incoming utterance in Chromium — the failure where the agent answers and
  // no sound comes out at all.
  speakBrowserText("A new answer.");
  assert.equal(engine.spoken.length, 0, "nothing spoken in the same tick as the cancel");
  await tick();
  assert.equal(engine.spoken.length, 1);
});

test("a new answer replaces the one in progress", async () => {
  speakBrowserText(LONG_ANSWER);
  await tick();
  const before = engine.cancels;

  speakBrowserText("A completely different answer.");
  await tick();

  assert.ok(engine.cancels > before);
  assert.equal(engine.spoken.at(-1)?.text, "A completely different answer.");
});

test("stopping clears the queue and the speech state", async () => {
  speakBrowserText(LONG_ANSWER);
  await tick();

  stopBrowserSpeech();
  assert.equal(getAgentSpeech().speaking, false);

  const spokenBefore = engine.spoken.length;
  engine.finishCurrent();
  assert.equal(engine.spoken.length, spokenBefore, "the rest of the queue is gone");
});

test("an utterance the engine swallows does not hang the session", async () => {
  // Accepted and never reported on. Without the stall watchdog the answer stops
  // here and the session waits on speech that is not coming.
  engine.swallow = true;
  speakBrowserText("Something the engine will drop.");
  await tick();

  assert.equal(getAgentSpeech().speaking, true);
  assert.equal(engine.spoken.length, 1, "a watchdog is the only way out of this");
});

test("an errored utterance moves on rather than stopping the answer", async () => {
  speakBrowserText(LONG_ANSWER);
  await tick();
  const first = engine.spoken.at(-1)!;

  engine.speaking = false;
  first.onerror?.();

  assert.equal(engine.spoken.length, 2, "the next chunk still gets its turn");
});

test("nothing sayable is not spoken at all", async () => {
  speakBrowserText("   ");
  speakBrowserText("");
  await tick();
  assert.equal(engine.spoken.length, 0);
});

test("a code-only answer says something rather than nothing", async () => {
  // Speaking nothing would leave the session waiting on audio that never comes.
  speakBrowserText("```\nrm -rf node_modules\n```");
  await tick();

  assert.equal(engine.spoken.length, 1);
  assert.ok(!engine.spoken[0].text.includes("rm -rf"));
});
