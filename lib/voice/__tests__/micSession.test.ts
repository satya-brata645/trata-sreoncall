import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  acquireMic,
  claimTurnOwnership,
  getMicLive,
  installMicSessionSeamForTests,
  isMicMuted,
  isMicSupported,
  micSessionStateForTests,
  registerMicSubscriber,
  releaseMic,
  releaseTurnOwnership,
  resetMicSessionForTests,
  setMicMuted,
} from "../mic-session";
import type { VoiceProviderCallbacks } from "../types";

/**
 * A recogniser that does nothing until told to, standing in for the browser's.
 *
 * The real one starts and ends itself constantly, which is exactly what the
 * restart backoff exists for — so the test drives those transitions explicitly
 * rather than waiting for a browser to produce them.
 */
class FakeRecognition {
  static built = 0;
  static latest: FakeRecognition | null = null;

  starts = 0;
  stops = 0;
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onresult: ((event: never) => void) | null = null;

  constructor() {
    FakeRecognition.built += 1;
    FakeRecognition.latest = this;
  }

  /** When set, the session ends instead of opening — a mic that will not start. */
  failToStart = false;

  start() {
    this.starts += 1;
    if (this.failToStart) {
      this.onend?.();
      return;
    }
    this.onstart?.();
  }
  stop() {
    this.stops += 1;
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }

  /** Deliver a result the way the Web Speech API shapes one. */
  say(transcript: string, isFinal: boolean) {
    const event = {
      resultIndex: 0,
      results: { length: 1, 0: { 0: { transcript }, isFinal } },
    };
    (this.onresult as unknown as ((e: unknown) => void) | null)?.(event);
  }

  fail(error: string) {
    this.onerror?.({ error });
  }
}

/** A clock the test advances, so the backoff is asserted rather than waited on. */
function makeClock() {
  const timers = new Map<number, { fire: () => void; at: number; ms: number }>();
  let now = 0;
  let nextId = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fire: fn, at: now + ms, ms });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    pending: () => [...timers.values()].map((timer) => timer.ms),
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.fire();
      }
    },
  };
}

let clock: ReturnType<typeof makeClock>;

beforeEach(() => {
  FakeRecognition.built = 0;
  FakeRecognition.latest = null;
  clock = makeClock();
  installMicSessionSeamForTests({
    createRecognition: () => new FakeRecognition() as unknown as never,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
});

afterEach(() => {
  installMicSessionSeamForTests(null);
  resetMicSessionForTests();
});

/** A subscriber that records everything it is told. */
function subscriber(token = Symbol("holder")) {
  const interim: string[] = [];
  const turns: string[] = [];
  const errors: Array<{ message: string; fatal: boolean }> = [];
  const callbacks: VoiceProviderCallbacks = {
    onInterim: (text) => interim.push(text),
    onTurnEnd: (text) => turns.push(text),
    onError: (error, fatal) => errors.push({ message: error.message, fatal }),
  };
  const unsubscribe = registerMicSubscriber(token, () => callbacks);
  return { token, interim, turns, errors, unsubscribe };
}

/* -------------------------------------------------------------------------- */
/* Mute gating                                                                 */
/* -------------------------------------------------------------------------- */

test("a fresh session is not muted", () => {
  // The bug this pins: `muted` used to start true, and only the chat composer
  // ever cleared it — so the wake-word session acquired the microphone and then
  // sat behind a mute nothing on the desktop could lift. No audio was ever
  // captured for it.
  assert.equal(isMicMuted(), false);
});

test("a holder is what opens the microphone, not the mute flag", () => {
  // Unmuted does not mean listening: nothing captures until something asks.
  assert.equal(micSessionStateForTests().wantsActive, false);
  assert.equal(FakeRecognition.built, 0);
});

test("acquiring opens recognition", async () => {
  const s = subscriber();
  await acquireMic(s.token);

  assert.equal(FakeRecognition.built, 1);
  assert.equal(FakeRecognition.latest?.starts, 1);
  assert.equal(getMicLive(), true);
  s.unsubscribe();
});

test("muting closes a live session and unmuting reopens it", async () => {
  const s = subscriber();
  await acquireMic(s.token);

  setMicMuted(true);
  assert.equal(getMicLive(), false);
  assert.equal(FakeRecognition.latest?.stops, 1);

  setMicMuted(false);
  assert.equal(getMicLive(), true);
  s.unsubscribe();
});

test("acquiring while muted captures nothing", async () => {
  // This is the command bar's push-to-talk state. It must not start capturing
  // just because something took a hold.
  setMicMuted(true);
  const s = subscriber();
  await acquireMic(s.token);

  assert.equal(FakeRecognition.built, 0);
  assert.equal(getMicLive(), false);
  s.unsubscribe();
});

test("a result arriving after a mute is discarded", async () => {
  // Recognition can deliver a result from a session muted mid-flight. Acting on
  // it would be a muted microphone dispatching instructions.
  const s = subscriber();
  await acquireMic(s.token);
  const recogniser = FakeRecognition.latest!;

  setMicMuted(true);
  recogniser.say("open the report", true);

  assert.deepEqual(s.turns, []);
  s.unsubscribe();
});

test("the last holder letting go closes the microphone", async () => {
  const a = subscriber(Symbol("a"));
  const b = subscriber(Symbol("b"));
  await acquireMic(a.token);
  await acquireMic(b.token);

  releaseMic(a.token);
  assert.equal(micSessionStateForTests().wantsActive, true, "one holder left");

  releaseMic(b.token);
  assert.equal(micSessionStateForTests().wantsActive, false);
  assert.equal(getMicLive(), false);
  a.unsubscribe();
  b.unsubscribe();
});

/* -------------------------------------------------------------------------- */
/* Turn ownership                                                              */
/* -------------------------------------------------------------------------- */

test("interim text reaches every subscriber", async () => {
  const desktop = subscriber(Symbol("desktop"));
  const composer = subscriber(Symbol("composer"));
  await acquireMic(desktop.token);

  FakeRecognition.latest!.say("what is exp", false);

  assert.deepEqual(desktop.interim, ["what is exp"]);
  assert.deepEqual(composer.interim, ["what is exp"], "display, so both see it");
  desktop.unsubscribe();
  composer.unsubscribe();
});

test("an unclaimed finished sentence reaches every subscriber", async () => {
  const desktop = subscriber(Symbol("desktop"));
  const composer = subscriber(Symbol("composer"));
  await acquireMic(desktop.token);

  FakeRecognition.latest!.say("open the report", true);

  assert.deepEqual(desktop.turns, ["open the report"]);
  assert.deepEqual(composer.turns, ["open the report"]);
  desktop.unsubscribe();
  composer.unsubscribe();
});

test("a claimed sentence goes to the claimant alone", async () => {
  // The double-send this prevents: the desktop's wake-word machine and the chat
  // composer both treat a finished sentence as an instruction, so one utterance
  // was submitted twice.
  const desktop = subscriber(Symbol("desktop"));
  const composer = subscriber(Symbol("composer"));
  await acquireMic(desktop.token);
  const release = claimTurnOwnership(desktop.token);

  FakeRecognition.latest!.say("open the report", true);

  assert.deepEqual(desktop.turns, ["open the report"]);
  assert.deepEqual(composer.turns, [], "the other consumer stays quiet");

  release();
  desktop.unsubscribe();
  composer.unsubscribe();
});

test("releasing the claim hands turns back to everyone", async () => {
  const desktop = subscriber(Symbol("desktop"));
  const composer = subscriber(Symbol("composer"));
  await acquireMic(desktop.token);

  const release = claimTurnOwnership(desktop.token);
  release();
  FakeRecognition.latest!.say("open the report", true);

  assert.deepEqual(composer.turns, ["open the report"]);
  desktop.unsubscribe();
  composer.unsubscribe();
});

test("a claimant that unmounted does not swallow the sentence", async () => {
  // Failing closed here would mean losing turns entirely, which is worse than
  // the duplication the claim exists to prevent.
  const desktop = subscriber(Symbol("desktop"));
  const composer = subscriber(Symbol("composer"));
  await acquireMic(desktop.token);
  claimTurnOwnership(desktop.token);

  desktop.unsubscribe();
  FakeRecognition.latest!.say("open the report", true);

  assert.deepEqual(composer.turns, ["open the report"]);
  composer.unsubscribe();
});

test("releasing someone else's claim is a no-op", async () => {
  const desktop = subscriber(Symbol("desktop"));
  const composer = subscriber(Symbol("composer"));
  await acquireMic(desktop.token);
  claimTurnOwnership(desktop.token);

  releaseTurnOwnership(composer.token);
  FakeRecognition.latest!.say("open the report", true);

  assert.deepEqual(composer.turns, []);
  desktop.unsubscribe();
  composer.unsubscribe();
});

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

test("silence and deliberate stops are not errors", async () => {
  const s = subscriber();
  await acquireMic(s.token);

  FakeRecognition.latest!.fail("no-speech");
  FakeRecognition.latest!.fail("aborted");

  assert.deepEqual(s.errors, [], "the normal shape of a live session");
  s.unsubscribe();
});

test("a refused microphone is fatal and stops the retry loop", async () => {
  // Without this the session kept wanting the mic, so `onend` restarted
  // straight back into the same refusal — a tight failure loop that also
  // flooded every subscriber's onError.
  const s = subscriber();
  await acquireMic(s.token);

  FakeRecognition.latest!.fail("not-allowed");

  assert.equal(s.errors.length, 1);
  assert.equal(s.errors[0].fatal, true);
  assert.equal(micSessionStateForTests().wantsActive, false);
  assert.equal(micSessionStateForTests().restartScheduled, false);
  s.unsubscribe();
});

test("every permanent refusal is treated the same way", async () => {
  for (const code of ["not-allowed", "service-not-allowed", "audio-capture"]) {
    resetMicSessionForTests();
    const s = subscriber();
    await acquireMic(s.token);
    FakeRecognition.latest!.fail(code);

    assert.equal(s.errors[0]?.fatal, true, code);
    assert.equal(micSessionStateForTests().wantsActive, false, code);
    s.unsubscribe();
  }
});

test("a network blip is reported but does not end the session", async () => {
  const s = subscriber();
  await acquireMic(s.token);

  FakeRecognition.latest!.fail("network");

  assert.equal(s.errors.length, 1);
  assert.equal(s.errors[0].fatal, false, "transient, so the session survives");
  assert.equal(micSessionStateForTests().wantsActive, true);
  s.unsubscribe();
});

/* -------------------------------------------------------------------------- */
/* Restart backoff                                                             */
/* -------------------------------------------------------------------------- */

test("a session the browser ended is reopened", async () => {
  // Native recognition stops itself after any pause. Without the restart the
  // wake word works exactly once.
  const s = subscriber();
  await acquireMic(s.token);
  const first = FakeRecognition.latest!;

  first.onend?.();
  assert.equal(getMicLive(), false);
  assert.equal(micSessionStateForTests().restartScheduled, true);

  clock.advance(1_000);
  assert.equal(getMicLive(), true);
  s.unsubscribe();
});

test("a session that will not open backs off instead of hammering", async () => {
  // A fixed retry against a recogniser that ends the moment it starts is a hot
  // loop. Each attempt has to wait longer than the last.
  const s = subscriber();
  await acquireMic(s.token);
  const recogniser = FakeRecognition.latest!;
  recogniser.failToStart = true;

  const delays: number[] = [];
  recogniser.onend?.();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [next] = clock.pending();
    assert.ok(next !== undefined, "a retry is scheduled");
    delays.push(next);
    clock.advance(next);
  }

  assert.deepEqual(delays, [120, 240, 480, 960]);
  s.unsubscribe();
});

test("the backoff is capped rather than growing without bound", async () => {
  const s = subscriber();
  await acquireMic(s.token);
  const recogniser = FakeRecognition.latest!;
  recogniser.failToStart = true;

  recogniser.onend?.();
  let last = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const [next] = clock.pending();
    if (next === undefined) break;
    last = next;
    clock.advance(next);
  }

  assert.equal(last, 2_000, "capped at the ceiling");
  s.unsubscribe();
});

test("a session that actually opens resets the backoff", async () => {
  // Proof the ceiling is not sticky: once the microphone works again, the next
  // ordinary pause must not wait two seconds to recover.
  const s = subscriber();
  await acquireMic(s.token);
  const failing = FakeRecognition.latest!;
  failing.failToStart = true;

  failing.onend?.();
  clock.advance(120);
  clock.advance(240);
  assert.ok(micSessionStateForTests().restartDelayMs > 120, "it grew");

  failing.failToStart = false;
  const [next] = clock.pending();
  clock.advance(next ?? 0);

  assert.equal(getMicLive(), true);
  assert.equal(micSessionStateForTests().restartDelayMs, 120);
  s.unsubscribe();
});

test("a muted session is not reopened behind the mute", async () => {
  const s = subscriber();
  await acquireMic(s.token);
  setMicMuted(true);

  clock.advance(10_000);
  assert.equal(getMicLive(), false);
  s.unsubscribe();
});

test("support is reported honestly", () => {
  assert.equal(isMicSupported(), true, "the seam stands in for a browser");
  installMicSessionSeamForTests(null);
  assert.equal(isMicSupported(), false, "no seam and no browser");
});
