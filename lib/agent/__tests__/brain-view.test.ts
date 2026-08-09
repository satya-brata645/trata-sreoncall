import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveHypotheses, deriveIncident, deriveWorkingMemory } from "../brain-view";
import { parseEvent, type SreEvent } from "../events";

function event(overrides: Record<string, unknown>): SreEvent {
  const parsed = parseEvent({
    source: "sre-engineer",
    kind: "detection",
    severity: "high",
    headline: "Something happened",
    ...overrides,
  });
  assert.ok(!("error" in parsed), "fixture must parse");
  return parsed;
}

const T0 = "2026-08-09T10:00:00.000Z";
const T6 = "2026-08-09T10:06:00.000Z";
const T13 = "2026-08-09T10:13:00.000Z";

// ---------------------------------------------------------------------------
// The incident
// ---------------------------------------------------------------------------

test("no incident id anywhere means no incident, not an invented one", () => {
  assert.equal(deriveIncident([event({ externalId: "a" })]), null);
  assert.equal(deriveIncident([]), null);
});

test("the incident is built from its first and latest events", () => {
  const incident = deriveIncident([
    event({ incidentId: "INC-1", at: T0, headline: "Checkout is failing", externalId: "a" }),
    event({
      incidentId: "INC-1",
      at: T13,
      kind: "diagnosis",
      headline: "Memory limit is the cause",
      summary: "Allocatable dropped 22%.",
      actionItems: ["Roll back the node pool"],
      externalId: "b",
    }),
  ]);

  assert.ok(incident);
  // The title is what it was first called; renaming an incident mid-flight
  // makes it unfindable in anything written down earlier.
  assert.equal(incident.title, "Checkout is failing");
  assert.equal(incident.startedAt, T0);
  assert.equal(incident.status, "Diagnosing");
  assert.equal(incident.summary, "Allocatable dropped 22%.");
  assert.equal(incident.nextAction, "Roll back the node pool");
});

test("severity is the worst it ever was, not the calmest thing said last", () => {
  const incident = deriveIncident([
    event({ incidentId: "INC-1", at: T0, severity: "critical", externalId: "a" }),
    event({ incidentId: "INC-1", at: T13, severity: "low", kind: "report", externalId: "b" }),
  ]);
  assert.equal(incident?.severity, "P1");
});

test("a recovery stays on screen rather than disappearing", () => {
  // The minutes after a fix are exactly when the panel is most worth reading.
  const incident = deriveIncident([
    event({ incidentId: "INC-1", at: T0, severity: "critical", externalId: "a" }),
    event({ incidentId: "INC-1", at: T13, kind: "resolved", externalId: "b" }),
  ]);
  assert.equal(incident?.status, "Resolved");
});

test("confidence is absent unless something reported one", () => {
  const without = deriveIncident([event({ incidentId: "INC-1", externalId: "a" })]);
  assert.equal(without?.confidence, undefined);
});

test("confidence tracks the leading diagnosis, not the last one mentioned", () => {
  // Caught on real data: posting a weak alternative *after* a strong one made
  // the incident report the weak number and look less understood than it was.
  const incident = deriveIncident([
    event({ incidentId: "INC-1", at: T0, kind: "diagnosis", confidence: 0.88, externalId: "a" }),
    event({ incidentId: "INC-1", at: T13, kind: "diagnosis", confidence: 0.31, externalId: "b" }),
  ]);
  assert.equal(incident?.confidence, 0.88);
});

test("before any diagnosis, the detection's own confidence stands", () => {
  const incident = deriveIncident([
    event({ incidentId: "INC-1", at: T0, kind: "detection", confidence: 0.5, externalId: "a" }),
  ]);
  assert.equal(incident?.confidence, 0.5);
});

test("the newest incident is the one shown", () => {
  const incident = deriveIncident([
    event({ incidentId: "INC-OLD", at: T0, externalId: "a" }),
    event({ incidentId: "INC-NEW", at: T13, externalId: "b" }),
  ]);
  assert.equal(incident?.id, "INC-NEW");
});

// ---------------------------------------------------------------------------
// Hypotheses
// ---------------------------------------------------------------------------

test("only diagnoses become hypotheses", () => {
  // Everything else is a thing that happened, not a thing that might be true.
  const derived = deriveHypotheses([
    event({ kind: "detection", externalId: "a" }),
    event({ kind: "diagnosis", headline: "It is the memory limit", externalId: "b" }),
    event({ kind: "remediation", externalId: "c" }),
  ]);
  assert.equal(derived.length, 1);
  assert.equal(derived[0]?.statement, "It is the memory limit");
});

test("exactly one hypothesis leads, and it is the most confident", () => {
  const derived = deriveHypotheses([
    event({ kind: "diagnosis", headline: "Weak theory", confidence: 0.3, externalId: "a" }),
    event({ kind: "diagnosis", headline: "Strong theory", confidence: 0.9, externalId: "b" }),
    event({ kind: "diagnosis", headline: "Middling theory", confidence: 0.6, externalId: "c" }),
  ]);

  assert.deepEqual(
    derived.map((h) => h.status),
    ["leading", "active", "watching"],
  );
  assert.equal(derived[0]?.statement, "Strong theory");
  assert.equal(derived.filter((h) => h.status === "leading").length, 1);
});

test("evidence is rendered as something a person can go and look at", () => {
  const derived = deriveHypotheses([
    event({
      kind: "diagnosis",
      evidence: [{ kind: "trace", ref: "a1f39c02", label: "failing span" }],
      externalId: "a",
    }),
  ]);
  assert.equal(derived[0]?.evidence, "failing span: a1f39c02");
});

// ---------------------------------------------------------------------------
// Working memory
// ---------------------------------------------------------------------------

test("stamps are relative to the first event, not the wall clock", () => {
  const memory = deriveWorkingMemory([
    event({ at: T0, externalId: "a" }),
    event({ at: T6, externalId: "b" }),
    event({ at: T13, externalId: "c" }),
  ]);
  assert.deepEqual(
    memory.map((entry) => entry.at),
    ["T+00m", "T+06m", "T+13m"],
  );
});

test("the summary is preferred over the headline, because it says more", () => {
  const [entry] = deriveWorkingMemory([
    event({ headline: "Short", summary: "The longer account.", externalId: "a" }),
  ]);
  assert.equal(entry?.text, "The longer account.");
  assert.equal(entry?.speaker, "SRE-ENGINEER");
});
