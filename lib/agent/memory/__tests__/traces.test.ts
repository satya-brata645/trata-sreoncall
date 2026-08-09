import { test } from "node:test";
import assert from "node:assert/strict";

import { confidenceFor, decayTrace, reinforceTrace, type MemoryTrace } from "../traces";

const T0 = new Date("2026-08-09T10:00:00.000Z");
const trace: MemoryTrace = {
  id: "stm-a",
  tier: "stm",
  kind: "incident",
  signature: "sre:detection:high:checkout-failing",
  strength: 0.8,
  hits: 1,
  lastHitAt: T0.toISOString(),
  createdAt: T0.toISOString(),
  confirmations: 3,
  contradictions: 1,
  evidence: [],
  sourceEventIds: ["evt-a"],
  activity: 0.8,
};

test("decay is exponential and preserves a trace's ordering signal", () => {
  const decayed = decayTrace(trace, new Date(T0.getTime() + 45 * 60_000));
  assert.equal(decayed.strength, 0.4);
  assert.equal(decayed.activity, 0.4);
});

test("reinforcement saturates below one without a clamp", () => {
  const reinforced = reinforceTrace({ ...trace, strength: 0.95 }, 1, T0);
  assert.ok(reinforced.strength > 0.95);
  assert.ok(reinforced.strength < 1);
  assert.equal(reinforced.hits, 2);
});

test("Laplace confidence stays humble on a small sample", () => {
  assert.equal(confidenceFor(trace), 4 / 6);
  assert.equal(confidenceFor({ confirmations: 0, contradictions: 0 }), 0.5);
});
