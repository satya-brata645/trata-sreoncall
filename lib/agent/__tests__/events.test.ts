import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEvent } from "../events";
import { parseDecision } from "../proactive";

// ---------------------------------------------------------------------------
// The ingest contract
// ---------------------------------------------------------------------------

const VALID = {
  source: "sre-engineer",
  kind: "detection",
  severity: "critical",
  headline: "Checkout is failing",
};

test("a missing field is named, not thrown", () => {
  // The producer is another agent. A 400 that says which field is something it
  // can act on; an exception is not.
  for (const [field, body] of [
    ["source", { ...VALID, source: "" }],
    ["headline", { ...VALID, headline: "  " }],
    ["kind", { ...VALID, kind: "gossip" }],
    ["severity", { ...VALID, severity: "quite bad" }],
  ] as const) {
    const parsed = parseEvent(body);
    assert.ok("error" in parsed, `${field} should have been rejected`);
    assert.match(parsed.error, new RegExp(field));
  }
});

test("the same event posted twice is the same event", () => {
  // The whole reason `externalId` exists: an SRE agent retrying a failed POST
  // must not produce a second incident.
  const a = parseEvent({ ...VALID, externalId: "run-1" });
  const b = parseEvent({ ...VALID, externalId: "run-1", headline: "Reworded entirely" });
  assert.ok(!("error" in a) && !("error" in b));
  assert.equal(a.id, b.id);
});

test("without an external id, the id still derives from content", () => {
  const at = "2026-08-09T10:00:00.000Z";
  const a = parseEvent({ ...VALID, at });
  const b = parseEvent({ ...VALID, at });
  assert.ok(!("error" in a) && !("error" in b));
  assert.equal(a.id, b.id);
});

test("optional lists are always lists", () => {
  // Downstream reads `.length` without guarding, which is only safe because
  // parsing normalises here.
  const parsed = parseEvent(VALID);
  assert.ok(!("error" in parsed));
  assert.deepEqual(parsed.actionItems, []);
  assert.deepEqual(parsed.evidence, []);
});

test("evidence without a ref is dropped, because it cannot be checked", () => {
  const parsed = parseEvent({
    ...VALID,
    evidence: [{ kind: "trace", ref: "abc" }, { kind: "trace", label: "no ref" }],
  });
  assert.ok(!("error" in parsed));
  assert.equal(parsed.evidence.length, 1);
});

// ---------------------------------------------------------------------------
// The brain's output contract
// ---------------------------------------------------------------------------

test("parseDecision fails closed on anything it cannot read", () => {
  // A background loop that invents something to say when the model was
  // unreachable is the exact failure the salience bar exists to prevent.
  for (const input of ["", "I think you should know that…", "{", '{"speak": true}', "null"]) {
    assert.deepEqual(parseDecision(input), { speak: false, message: "" });
  }
});

test("parseDecision reads a fenced answer", () => {
  const decision = parseDecision('```json\n{"speak": true, "message": "Checkout is down."}\n```');
  assert.deepEqual(decision, { speak: true, message: "Checkout is down." });
});

test("speak without a message is silence", () => {
  assert.equal(parseDecision('{"speak": true, "message": "   "}').speak, false);
});

// ---------------------------------------------------------------------------
// `learning` — the kind that reports on the agent rather than the target system
// ---------------------------------------------------------------------------

const VALID_LEARNING = {
  source: "sre-engineer/log-triage",
  kind: "learning",
  severity: "info",
  headline: "Learned: confirm traffic before reading a drop in errors",
  learning: {
    capability: "log-triage",
    artifact: "capabilities/log-triage/.claude/skills/log-triage/baselines/product-catalog.md",
    artifactKind: "baseline",
    origin: "self-authored",
    lesson: "Zero errors means nothing if zero requests were served in the same window.",
  },
};

test("a learning event carries its provenance", () => {
  const event = parseEvent(VALID_LEARNING);
  assert.ok(!("error" in event));
  if ("error" in event) return;
  assert.equal(event.learning?.capability, "log-triage");
  assert.equal(event.learning?.artifactKind, "baseline");
  assert.equal(event.learning?.origin, "self-authored");
});

test("a learning with nothing to check is refused", () => {
  // This is the one kind that would actively mislead if it were accepted with
  // holes: it would render as "the agent learned something" while carrying
  // nothing a reader could go and verify.
  for (const [missing, learning] of [
    ["capability", { ...VALID_LEARNING.learning, capability: "" }],
    ["artifact", { ...VALID_LEARNING.learning, artifact: "  " }],
    ["lesson", { ...VALID_LEARNING.learning, lesson: "" }],
    ["artifactKind", { ...VALID_LEARNING.learning, artifactKind: "vibes" }],
    ["origin", { ...VALID_LEARNING.learning, origin: "osmosis" }],
  ] as const) {
    const result = parseEvent({ ...VALID_LEARNING, learning });
    assert.ok("error" in result, `expected ${missing} to be rejected`);
    assert.match((result as { error: string }).error, new RegExp(missing));
  }
});

test("an absorbed correction must say which correction", () => {
  // Claiming to have absorbed a correction is the harder half of the dimension
  // and the one a reader is most entitled to be sceptical about, so it has to
  // name the file it came from.
  const result = parseEvent({
    ...VALID_LEARNING,
    learning: { ...VALID_LEARNING.learning, origin: "correction-absorbed" },
  });
  assert.ok("error" in result);
  assert.match((result as { error: string }).error, /correctionRef/);

  const ok = parseEvent({
    ...VALID_LEARNING,
    learning: {
      ...VALID_LEARNING.learning,
      origin: "correction-absorbed",
      correctionRef: "corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md",
    },
  });
  assert.ok(!("error" in ok));
});

test("learning detail is absent on every other kind", () => {
  const event = parseEvent({ ...VALID, learning: VALID_LEARNING.learning });
  assert.ok(!("error" in event));
  if ("error" in event) return;
  assert.equal(event.learning, undefined);
});
