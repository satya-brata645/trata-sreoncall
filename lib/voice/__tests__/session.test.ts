import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VoiceSession,
  THINKING_TIMEOUT_MS,
  AWAKE_TIMEOUT_MS,
  CONFIRMING_TIMEOUT_MS,
} from "../session";
import { detectWakeWord } from "../wakeWord";
import { parseConsent } from "../consent";
import { echoSimilarity, isStopPhrase, localEchoDecision } from "../interrupt-arbiter";

/** A clock the test drives, so timeouts are asserted rather than waited for. */
function makeClock() {
  const timers = new Map<number, { fire: () => void; at: number }>();
  let now = 0;
  let nextId = 1;

  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fire: fn, at: now + ms });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
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

function makeSession(origin: "hotkey" | "ambient" = "hotkey") {
  const clock = makeClock();
  const dispatched: string[] = [];
  const consents: boolean[] = [];
  const heard: string[] = [];
  let timedOut = 0;
  let approvalTimedOut = 0;
  const session = new VoiceSession({
    detectWake: detectWakeWord,
    parseConsent,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    events: {
      onDispatch: (text) => dispatched.push(text),
      onHeard: (text) => heard.push(text),
      onConsent: (approved) => consents.push(approved),
      onAnswerTimeout: () => {
        timedOut += 1;
      },
      onApprovalTimeout: () => {
        approvalTimedOut += 1;
      },
    },
  });
  session.open(origin);
  return {
    session,
    clock,
    dispatched,
    consents,
    heard,
    timeouts: () => timedOut,
    approvalTimeouts: () => approvalTimedOut,
  };
}

test("a dispatched turn parks the session in thinking", () => {
  const { session, dispatched } = makeSession();
  session.onTurnEnd("open the reachability report");
  assert.deepEqual(dispatched, ["open the reachability report"]);
  assert.equal(session.getMode(), "thinking");
});

test("an answer that never speaks does not leave the session deaf", () => {
  // The failure this covers: the request fails, or the round is all tool calls,
  // so speech never starts. `thinking` ignores every transcript, so without the
  // watchdog the microphone stayed open and nothing said afterwards could ever
  // be heard again.
  const { session, clock, dispatched } = makeSession();
  session.onTurnEnd("what changed overnight");
  assert.equal(session.getMode(), "thinking");

  clock.advance(THINKING_TIMEOUT_MS);
  assert.equal(session.getMode(), "awake");

  session.onTurnEnd("try that again");
  assert.deepEqual(dispatched, ["what changed overnight", "try that again"]);
});

test("the watchdog reports itself so the surface can say something", () => {
  const { session, clock, timeouts } = makeSession();
  session.onTurnEnd("anything");
  clock.advance(THINKING_TIMEOUT_MS);
  assert.equal(timeouts(), 1);
});

test("an ambient session falls back to ambient, not awake", () => {
  const { session, clock } = makeSession("ambient");
  session.onTurnEnd("hey SOS what is exposed");
  assert.equal(session.getMode(), "thinking");
  clock.advance(THINKING_TIMEOUT_MS);
  assert.equal(session.getMode(), "ambient");
});

test("an answer that does arrive cancels the watchdog", () => {
  const { session, clock, timeouts } = makeSession();
  session.onTurnEnd("open chat");
  session.onAnswerStart();
  assert.equal(session.getMode(), "speaking");

  clock.advance(THINKING_TIMEOUT_MS * 2);
  assert.equal(timeouts(), 0);
  assert.equal(session.getMode(), "speaking");

  session.onAnswerEnd();
  assert.equal(session.getMode(), "awake");
});

test("a closed session's watchdog cannot reopen it", () => {
  const { session, clock } = makeSession();
  session.onTurnEnd("open chat");
  session.close();
  clock.advance(THINKING_TIMEOUT_MS);
  assert.equal(session.getMode(), "idle");
});

test("the awake timeout still returns an ambient session to waiting", () => {
  const { session, clock } = makeSession("ambient");
  session.onTurnEnd("hey SOS");
  assert.equal(session.getMode(), "awake");
  clock.advance(AWAKE_TIMEOUT_MS);
  assert.equal(session.getMode(), "ambient");
});

/* -------------------------------------------------------------------------- */
/* Confirming                                                                  */
/* -------------------------------------------------------------------------- */

test("a pending approval turns the session into an ear for yes or no", () => {
  const { session } = makeSession();
  session.onApprovalPending();
  assert.equal(session.getMode(), "confirming");
});

test("saying yes and saying no both reach the decision", () => {
  for (const [said, expected] of [["yes", true], ["no", false]] as const) {
    const { session, consents } = makeSession();
    session.onApprovalPending();
    session.onTurnEnd(said);
    assert.deepEqual(consents, [expected], said);
  }
});

test("an unclear answer decides nothing", () => {
  // Ambiguity is not consent. The question stays open and the words are shown
  // back rather than guessed at.
  const { session, consents, heard } = makeSession();
  session.onApprovalPending();
  session.onTurnEnd("what would that change");

  assert.deepEqual(consents, []);
  assert.equal(session.getMode(), "confirming");
  assert.ok(heard.includes("what would that change"));
});

test("a question nobody answers is not left open", () => {
  // Without this the session sat in `confirming` forever: an unclear answer
  // re-arms nothing and the mode is left only when the store empties, so a
  // decision nobody makes leaves the microphone deaf and the approval
  // half-open.
  const { session, clock, approvalTimeouts } = makeSession();
  session.onApprovalPending();
  clock.advance(CONFIRMING_TIMEOUT_MS);

  assert.equal(approvalTimeouts(), 1, "the handler is told, so it can deny");
  assert.equal(session.getMode(), "awake", "and the session hears again");
});

test("the deadline runs from the question, not from the last thing said", () => {
  // Talking around a question must not keep it alive indefinitely.
  const { session, clock, approvalTimeouts } = makeSession();
  session.onApprovalPending();
  clock.advance(CONFIRMING_TIMEOUT_MS - 1000);
  session.onTurnEnd("hang on, what is in it");
  assert.equal(session.getMode(), "confirming");

  clock.advance(1000);
  assert.equal(approvalTimeouts(), 1);
});

test("an answered question does not time out afterwards", () => {
  const { session, clock, approvalTimeouts } = makeSession();
  session.onApprovalPending();
  session.onTurnEnd("yes");
  session.onApprovalResolved();

  clock.advance(CONFIRMING_TIMEOUT_MS * 2);
  assert.equal(approvalTimeouts(), 0);
});

test("an ambient session goes back to waiting, not to awake", () => {
  const { session, clock } = makeSession("ambient");
  session.onApprovalPending();
  clock.advance(CONFIRMING_TIMEOUT_MS);
  assert.equal(session.getMode(), "ambient");
});

test("a closed session's approval watchdog cannot reopen it", () => {
  const { session, clock, approvalTimeouts } = makeSession();
  session.onApprovalPending();
  session.close();
  clock.advance(CONFIRMING_TIMEOUT_MS);

  assert.equal(approvalTimeouts(), 0);
  assert.equal(session.getMode(), "idle");
});

/* -------------------------------------------------------------------------- */

test("echo overlap survives dropped words", () => {
  const said = "Three of the eleven advisories reach production code paths";
  const heard = "three of eleven advisories reach production paths";
  assert.ok(echoSimilarity(heard, said) >= 0.6);
});

test("a distinct instruction does not look like echo", () => {
  const said = "Three of the eleven advisories reach production code paths";
  assert.ok(echoSimilarity("open the compliance app instead", said) < 0.6);
});

test("the agent's own words are ignored rather than treated as an interruption", () => {
  // The substring check this replaces almost never matched, so every word the
  // microphone caught off the speakers was dispatched back as a user turn and
  // the agent held a conversation with itself.
  const said = "I have opened the reachability report next to the CVE matrix";
  const decision = localEchoDecision("i have opened the reachability report", said);
  assert.equal(decision.verdict, "ignore");
});

test("a real interruption still interrupts", () => {
  const said = "I have opened the reachability report next to the CVE matrix";
  assert.equal(localEchoDecision("no show me the exposed hosts", said).verdict, "interrupt");
});

test("a stop phrase wins even when the agent just said it", () => {
  assert.ok(isStopPhrase("stop"));
  assert.equal(localEchoDecision("stop", "stop me if you have heard this").verdict, "interrupt");
  assert.equal(localEchoDecision("wait wait wait", "the matrix is open").verdict, "interrupt");
});

test("a single stray word off the speakers is not an interruption", () => {
  assert.equal(localEchoDecision("matrix", "the CVE matrix is open").verdict, "ignore");
});

test("an unknown short fragment is ignored rather than dispatched", () => {
  assert.equal(localEchoDecision("um", "").verdict, "ignore");
});
