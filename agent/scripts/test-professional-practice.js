// Unit tests for the mechanical parts of the continuous professional-practice
// loop. No model call, telemetry query, or skill-file mutation is needed.
const assert = require("node:assert");
const state = require("../src/state");
const loader = require("../src/skills/loader");
const practice = require("../src/professional-practice");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok  - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(`      ${err.message}`);
    process.exitCode = 1;
  }
}

test("resolved incident receives three later review iterations", () => {
  const s = state.emptyState();
  s.performance.sweeps_run = 8;
  const incident = { id: "inc_abc123def456", alert_ids: ["alt_abc123def456"] };
  const followUp = practice.scheduleResolvedIncident({ state: s, incident });
  assert.strictEqual(followUp.reviews_remaining, practice.FOLLOW_UP_ITERATIONS);
  assert.strictEqual(followUp.last_checked_sweep, 8);
  assert.strictEqual(s.practice.follow_ups.length, 1);
});

test("resolved incident is scheduled once even if resolution handling is retried", () => {
  const s = state.emptyState();
  const incident = { id: "inc_abc123def456", alert_ids: [] };
  practice.scheduleResolvedIncident({ state: s, incident });
  const duplicate = practice.scheduleResolvedIncident({ state: s, incident });
  assert.strictEqual(duplicate, null);
  assert.strictEqual(s.practice.follow_ups.length, 1);
});

test("only evidence refs observed in the review tool trail survive", () => {
  const refs = practice.validReviewEvidence(
    { evidence_refs: ["ev_111111111111", "ev_not_observed"] },
    [{ output: { evidence_ref: "ev_111111111111" } }]
  );
  assert.deepStrictEqual(refs, ["ev_111111111111"]);
});

test("professional-practice skills are discoverable through the normal loader", () => {
  const names = loader.listDescriptions().filter((skill) => skill.origin === "professional-practice").map((skill) => skill.name);
  assert.ok(names.includes("verify-recovery-over-time"));
  assert.ok(names.includes("turn-recurrence-into-a-playbook"));
});

console.log(`\n${passed} passed${process.exitCode ? ", with failures" : ""}.`);
