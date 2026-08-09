import { test } from "node:test";
import assert from "node:assert/strict";

import { MATTERS_WEIGHT, score, scoreInContext, split } from "../salience";
import { parseEvent, type SreEvent } from "../events";

function event(overrides: Partial<SreEvent> = {}): SreEvent {
  const parsed = parseEvent({
    source: "sre-engineer",
    kind: "detection",
    severity: "low",
    headline: "Something happened",
    ...overrides,
  });
  assert.ok(!("error" in parsed), "fixture must parse");
  return { ...parsed, ...overrides } as SreEvent;
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

test("critical and high clear the bar on severity alone", () => {
  assert.equal(score(event({ severity: "critical" })).matters, true);
  assert.equal(score(event({ severity: "high", evidence: [{ kind: "log", ref: "x" }] })).matters, true);
});

test("low and info never clear it on their own", () => {
  assert.equal(score(event({ severity: "low" })).matters, false);
  assert.equal(score(event({ severity: "info" })).matters, false);
});

test("something to do is worth a step", () => {
  // Medium alone sits below the bar; medium with a next action reaches it.
  // This is the whole reason the weight is not just the severity map.
  assert.equal(score(event({ severity: "medium" })).matters, false);
  assert.equal(
    score(event({ severity: "medium", actionItems: ["Roll it back"] })).matters,
    true,
  );
});

test("a recovery is always worth saying", () => {
  // An agent that reports the break and not the fix leaves the user believing
  // something is still on fire.
  const resolved = score(event({ severity: "info", kind: "resolved" }));
  assert.equal(resolved.matters, true);
  assert.ok(resolved.weight >= MATTERS_WEIGHT);
});

test("a claim with nothing to check breaks the tie downward", () => {
  const cited = score(event({ severity: "high", evidence: [{ kind: "trace", ref: "abc" }] }));
  const uncited = score(event({ severity: "high", evidence: [] }));
  assert.equal(cited.matters, true);
  assert.equal(uncited.matters, false);
  assert.match(uncited.because, /no evidence/);
});

test("the reason is stated in words, because it gets shown", () => {
  const { because } = score(event({ severity: "critical", actionItems: ["Do the thing"] }));
  assert.match(because, /critical severity/);
  assert.match(because, /action items/);
});

// ---------------------------------------------------------------------------
// Splitting a batch
// ---------------------------------------------------------------------------

test("split keeps every event, on one side or the other", () => {
  const events = [
    event({ severity: "critical", externalId: "a" }),
    event({ severity: "info", externalId: "b" }),
    event({ severity: "medium", actionItems: ["x"], externalId: "c" }),
  ];
  const { mattering, rest } = split(events);
  assert.equal(mattering.length + rest.length, events.length);
  assert.equal(mattering.length, 2);
});

test("context salience calls out a novel event instead of treating it as an ordinary medium", () => {
  const medium = event({ severity: "medium", evidence: [{ kind: "metric", ref: "m1" }] });
  const contextual = scoreInContext(medium, { working: [], episodes: [], longTerm: [] });
  assert.equal(contextual.matters, true);
  assert.match(contextual.because, /never seen before/);
});

test("context salience habituates repeated signatures without fully silencing them", () => {
  const repeated = event({ severity: "critical", evidence: [{ kind: "log", ref: "l1" }] });
  const memory = {
    working: [
      {
        id: "stm-old",
        tier: "stm" as const,
        kind: "incident" as const,
        signature: "sre-engineer:detection:critical:something-happened",
        strength: 0.9,
        hits: 5,
        lastHitAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        confirmations: 0,
        contradictions: 0,
        evidence: [],
        sourceEventIds: ["old"],
      },
    ],
    episodes: [],
    longTerm: [],
  };
  const contextual = scoreInContext(repeated, memory);
  assert.match(contextual.because, /repeated recently/);
  assert.equal(contextual.matters, true);
});
