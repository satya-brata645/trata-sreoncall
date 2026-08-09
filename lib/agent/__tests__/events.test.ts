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
