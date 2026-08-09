import { test } from "node:test";
import assert from "node:assert/strict";

import { confidenceFor, decayTrace, reinforceTrace, traceForLearning, type MemoryTrace } from "../traces";

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

// ---------------------------------------------------------------------------
// Learnings — durable on arrival, not observations earning their place
// ---------------------------------------------------------------------------

const LEARNING_EVENT = {
  id: "evt-learn-1",
  source: "sre-engineer/log-triage",
  kind: "learning" as const,
  severity: "info" as const,
  headline: "Learned: confirm traffic before reading a drop in errors",
  at: "2026-08-09T13:43:00.000Z",
  receivedAt: "2026-08-09T13:43:01.000Z",
  actionItems: [],
  evidence: [],
  incidentId: "inc-001",
  learning: {
    capability: "log-triage",
    artifact: "baselines/product-catalog.md",
    artifactKind: "baseline" as const,
    origin: "self-authored" as const,
    lesson: "Zero errors means nothing if zero requests were served.",
  },
};

test("a learning lands in long-term memory, not short-term", () => {
  // It is a lesson already written to a file and cited to evidence — sending it
  // through short-term decay would let the agent forget something it
  // deliberately chose to remember.
  const trace = traceForLearning(LEARNING_EVENT)!;
  assert.equal(trace.tier, "ltm");
  assert.equal(trace.kind, "fact");
  assert.equal(trace.summary, LEARNING_EVENT.learning.lesson);
});

test("a learned procedure is filed as a procedure, an observation as a fact", () => {
  const playbook = traceForLearning({
    ...LEARNING_EVENT,
    learning: { ...LEARNING_EVENT.learning, artifactKind: "playbook" as const },
  })!;
  assert.equal(playbook.kind, "procedure");
});

test("an absorbed correction records that a belief was contradicted", () => {
  // "This belief changed, and here is what changed it" has to stay legible
  // later — a corrected belief that appears fully-formed teaches nobody.
  const corrected = traceForLearning({
    ...LEARNING_EVENT,
    learning: {
      ...LEARNING_EVENT.learning,
      origin: "correction-absorbed" as const,
      correctionRef: "corrections/log-triage/quiet-window.md",
    },
  })!;
  assert.equal(corrected.contradictions, 1);
  assert.equal(corrected.confirmations, 0);
});

test("an event with no learning detail yields no learning trace", () => {
  assert.equal(traceForLearning({ ...LEARNING_EVENT, learning: undefined }), null);
});
