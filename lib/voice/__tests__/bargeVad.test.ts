import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BARGE_IN_SETTLE_MS,
  BARGE_VAD_DELTA,
  BARGE_VAD_SUSTAIN_MS,
  BargeVad,
  VAD_PAUSE_FALLBACK_MS,
  VAD_TICK_MS,
} from "../barge-vad";
import type { ArbiterDecision } from "../interrupt-arbiter";

/**
 * Barge-in is the most stateful thing in the voice subsystem and had no tests,
 * despite `setTimer`/`clearTimer`/`setTicker`/`clearTicker` existing on its deps
 * purely so it could have them. Everything below drives the real class through
 * those seams.
 */

function harness(
  options: {
    arbitrate?: (transcript: string, said: string) => Promise<ArbiterDecision>;
    playback?: boolean;
    settled?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const interrupted: string[] = [];
  let mic = 0;
  let out = 0;
  let settled = options.settled ?? true;

  const timers = new Map<number, { fire: () => void; at: number }>();
  const tickers = new Map<number, { fire: () => void; every: number; next: number }>();
  let now = 0;
  let nextId = 1;

  const playback = {
    getLevel: () => out,
    pauseFast: () => calls.push("pause"),
    resumeFast: () => calls.push("resume"),
    barge: () => calls.push("barge"),
  };

  const vad = new BargeVad({
    getMicRms: () => mic,
    getPlayback: () => (options.playback === false ? null : playback),
    hasSettled: () => settled,
    getAgentLine: () => "the reachability report is open on the left",
    arbitrate:
      options.arbitrate ??
      (async () => ({ verdict: "interrupt", reason: "test" }) as ArbiterDecision),
    onInterrupt: (text) => interrupted.push(text),
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fire: fn, at: now + ms });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    setTicker: (fn, ms) => {
      const id = nextId++;
      tickers.set(id, { fire: fn, every: ms, next: now + ms });
      return id;
    },
    clearTicker: (handle) => {
      tickers.delete(handle as number);
    },
  });

  return {
    vad,
    calls,
    interrupted,
    setLevels(nextMic: number, nextOut: number) {
      mic = nextMic;
      out = nextOut;
    },
    setSettled(next: boolean) {
      settled = next;
    },
    advance(ms: number) {
      const until = now + ms;
      while (now < until) {
        now += VAD_TICK_MS;
        for (const ticker of [...tickers.values()]) {
          if (ticker.next > now) continue;
          ticker.next = now + ticker.every;
          ticker.fire();
        }
        for (const [id, timer] of [...timers]) {
          if (timer.at > now) continue;
          timers.delete(id);
          timer.fire();
        }
      }
    },
  };
}

/** Let queued microtasks (the arbiter's promise) run. */
const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

/* -------------------------------------------------------------------------- */
/* Arming                                                                      */
/* -------------------------------------------------------------------------- */

test("a disarmed loop ignores everything", () => {
  const h = harness();
  h.setLevels(1, 0);
  h.advance(1_000);
  h.vad.onTranscript("stop talking");

  assert.equal(h.vad.isArmed(), false);
  assert.deepEqual(h.calls, [], "nothing touches playback until it is armed");
});

test("arming twice does not start two tickers", () => {
  const h = harness();
  h.vad.arm();
  h.vad.arm();
  assert.equal(h.vad.isArmed(), true);
});

test("disarming resumes playback it had paused", () => {
  // A pause with nothing left to un-pause it is an agent that goes silent
  // mid-sentence and never comes back.
  const h = harness();
  h.vad.arm();
  h.vad.onTranscript("wait");
  assert.ok(h.calls.includes("pause"));

  h.vad.disarm();
  assert.equal(h.vad.isPaused(), false);
  assert.equal(h.calls.at(-1), "resume");
});

/* -------------------------------------------------------------------------- */
/* The level path                                                              */
/* -------------------------------------------------------------------------- */

test("sustained speech over the agent pauses it", () => {
  const h = harness();
  h.vad.arm();
  h.setLevels(BARGE_VAD_DELTA * 4, 0);

  h.advance(BARGE_VAD_SUSTAIN_MS + VAD_TICK_MS);
  assert.equal(h.vad.isPaused(), true);
  assert.ok(h.calls.includes("pause"));
});

test("a brief blip is not a barge-in", () => {
  // Without the sustain requirement a cough or a door pauses the agent.
  const h = harness();
  h.vad.arm();
  h.setLevels(BARGE_VAD_DELTA * 4, 0);
  h.advance(VAD_TICK_MS * 2);
  h.setLevels(0, 0);
  h.advance(BARGE_VAD_SUSTAIN_MS * 2);

  assert.equal(h.vad.isPaused(), false);
  assert.deepEqual(h.calls, []);
});

test("the agent's own output is not mistaken for the user", () => {
  // Mic and playback both loud means the microphone is hearing the speakers.
  const h = harness();
  h.vad.arm();
  h.setLevels(0.9, 0.9);
  h.advance(BARGE_VAD_SUSTAIN_MS * 3);

  assert.equal(h.vad.isPaused(), false);
});

test("nothing happens before playback has settled", () => {
  // The first moments of audio are unreliable; acting on them would let the
  // agent barge on itself the instant it starts talking.
  const h = harness({ settled: false });
  h.vad.arm();
  h.setLevels(1, 0);
  h.advance(BARGE_IN_SETTLE_MS * 4);

  assert.equal(h.vad.isPaused(), false);
});

test("with nothing playing there is nothing to interrupt", () => {
  const h = harness({ playback: false });
  h.vad.arm();
  h.setLevels(1, 0);
  h.advance(BARGE_VAD_SUSTAIN_MS * 3);

  assert.equal(h.vad.isPaused(), false);
});

/* -------------------------------------------------------------------------- */
/* The transcript path                                                         */
/* -------------------------------------------------------------------------- */

test("a transcript pauses first and asks afterwards", async () => {
  // Pausing before the verdict is the point: waiting for an answer before
  // stopping means talking over someone for the length of the round trip.
  let release: (decision: ArbiterDecision) => void = () => {};
  const h = harness({
    arbitrate: () => new Promise<ArbiterDecision>((resolve) => (release = resolve)),
  });
  h.vad.arm();
  h.vad.onTranscript("no, the other one");

  assert.deepEqual(h.calls, ["pause"]);
  assert.equal(h.vad.isPaused(), true);

  release({ verdict: "interrupt", reason: "distinct" });
  await settleMicrotasks();

  assert.deepEqual(h.calls, ["pause", "barge"]);
  assert.deepEqual(h.interrupted, ["no, the other one"]);
});

test("echo resumes playback instead of stopping it", async () => {
  const h = harness({
    arbitrate: async () => ({ verdict: "ignore", reason: "local_echo" }),
  });
  h.vad.arm();
  h.vad.onTranscript("the reachability report is open");
  await settleMicrotasks();

  assert.deepEqual(h.calls, ["pause", "resume"]);
  assert.deepEqual(h.interrupted, [], "the agent does not interrupt itself");
  assert.equal(h.vad.isPaused(), false);
});

test("blank transcripts are ignored", () => {
  const h = harness();
  h.vad.arm();
  h.vad.onTranscript("   ");
  assert.deepEqual(h.calls, []);
});

test("an arbiter that throws stops the agent anyway", async () => {
  // Talking over someone trying to stop you is worse than pausing by mistake.
  const h = harness({
    arbitrate: async () => {
      throw new Error("unreachable");
    },
  });
  h.vad.arm();
  h.vad.onTranscript("hold on a second");
  await settleMicrotasks();

  assert.deepEqual(h.interrupted, ["hold on a second"]);
  assert.ok(h.calls.includes("barge"));
});

/* -------------------------------------------------------------------------- */
/* Not being left paused                                                       */
/* -------------------------------------------------------------------------- */

test("a verdict that never arrives does not leave the agent muted", async () => {
  // The fallback is the difference between a slow arbiter and an agent that
  // stops mid-sentence forever.
  const h = harness({ arbitrate: () => new Promise<ArbiterDecision>(() => {}) });
  h.vad.arm();
  h.vad.onTranscript("what about the other one");
  assert.equal(h.vad.isPaused(), true);

  h.advance(VAD_PAUSE_FALLBACK_MS + VAD_TICK_MS);
  assert.equal(h.vad.isPaused(), false);
  assert.deepEqual(h.calls, ["pause", "resume"]);
});

test("a verdict that arrives after the fallback is discarded", async () => {
  // Otherwise a late "interrupt" barges into whatever the agent has since
  // moved on to saying.
  let release: (decision: ArbiterDecision) => void = () => {};
  const h = harness({
    arbitrate: () => new Promise<ArbiterDecision>((resolve) => (release = resolve)),
  });
  h.vad.arm();
  h.vad.onTranscript("something");
  h.advance(VAD_PAUSE_FALLBACK_MS + VAD_TICK_MS);

  release({ verdict: "interrupt", reason: "late" });
  await settleMicrotasks();

  assert.deepEqual(h.interrupted, [], "the stale decision is dropped");
  assert.ok(!h.calls.includes("barge"));
});

test("a verdict that arrives after disarming is discarded", async () => {
  let release: (decision: ArbiterDecision) => void = () => {};
  const h = harness({
    arbitrate: () => new Promise<ArbiterDecision>((resolve) => (release = resolve)),
  });
  h.vad.arm();
  h.vad.onTranscript("something");
  h.vad.disarm();

  release({ verdict: "interrupt", reason: "late" });
  await settleMicrotasks();

  assert.deepEqual(h.interrupted, []);
});

test("a second transcript supersedes the first verdict", async () => {
  // Two questions in flight must not both act; only the newest one counts.
  const pending: Array<(decision: ArbiterDecision) => void> = [];
  const h = harness({
    arbitrate: () => new Promise<ArbiterDecision>((resolve) => pending.push(resolve)),
  });
  h.vad.arm();
  h.vad.onTranscript("first thing");
  h.vad.onTranscript("second thing");

  pending[0]({ verdict: "interrupt", reason: "stale" });
  await settleMicrotasks();
  assert.deepEqual(h.interrupted, []);

  pending[1]({ verdict: "interrupt", reason: "current" });
  await settleMicrotasks();
  assert.deepEqual(h.interrupted, ["second thing"]);
});
