// Unit tests for src/skills/gates.js — pure functions, zero API calls, zero
// rate-limit risk. Run first per PLAN-malleability-only-95.md §7 step 1.
const assert = require("node:assert");
const { scrubIncidentIdentifiers, skillContentGate, hasEvidencedDuplicateSearch, promotionGate } = require("../src/skills/gates");

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

const goodCandidate = { text: "When <SERVICE> consumer lag climbs steadily while producer throughput stays flat, suspect a consumer-side stall, not a producer surge." };
const goodJudgment = {
  generalizable: true,
  material: true,
  not_already_captured: true,
  minimal_footprint: true,
  footprint: "new-file",
  no_host_reason: "no existing skill discusses queue lag discrimination",
  duplicate_search: [{ query: "consumer lag", hits: 0 }],
};
const promoteConsensus = { decision: "PROMOTE", reasoning: "no strong objection", deciding_factor: "no citation-backed refutation" };
const rejectConsensus = { decision: "REJECT", reasoning: "one refuter cited an exact duplicate", deciding_factor: "already captured — see triangulate-signals.md" };

test("all gates true + consensus PROMOTE + clean text -> PROMOTE", () => {
  const result = promotionGate(goodCandidate, goodJudgment, promoteConsensus);
  assert.strictEqual(result.decision, "PROMOTE");
});

test("generalizable=false -> SKIP naming generalizable", () => {
  const result = promotionGate(goodCandidate, { ...goodJudgment, generalizable: false }, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
  assert.ok(result.failed_gates.includes("generalizable"));
});

test("material=false -> SKIP naming material", () => {
  const result = promotionGate(goodCandidate, { ...goodJudgment, material: false }, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
  assert.ok(result.failed_gates.includes("material"));
});

test("minimal_footprint=false -> SKIP naming minimal_footprint", () => {
  const result = promotionGate(goodCandidate, { ...goodJudgment, minimal_footprint: false }, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
  assert.ok(result.failed_gates.includes("minimal_footprint"));
});

test("not_already_captured=false -> SKIP naming not_already_captured", () => {
  const result = promotionGate(goodCandidate, { ...goodJudgment, not_already_captured: false }, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
  assert.ok(result.failed_gates.includes("not_already_captured"));
});

test("not_already_captured=true but empty duplicate_search -> SKIP on unevidenced", () => {
  const result = promotionGate(goodCandidate, { ...goodJudgment, duplicate_search: [] }, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
  assert.ok(result.failed_gates.some((g) => g.includes("unevidenced")));
});

test("footprint=new-file with no no_host_reason -> SKIP", () => {
  const result = promotionGate(goodCandidate, { ...goodJudgment, no_host_reason: "" }, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
  assert.ok(result.failed_gates.some((g) => g.includes("no_host_reason")));
});

test("all four gates true but Consensus REJECTs -> REJECT (proves Consensus has real veto power)", () => {
  const result = promotionGate(goodCandidate, goodJudgment, rejectConsensus);
  assert.strictEqual(result.decision, "REJECT");
  assert.ok(result.reason.includes("already captured"));
});

test("candidate text containing an incident id -> SKIP on scrub", () => {
  const dirty = { text: "In inc_4a67dced536a, the consumer lag climbed steadily." };
  const result = promotionGate(dirty, goodJudgment, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
  assert.ok(result.failed_gates.some((g) => g.startsWith("generalizable:scrub")));
});

test("candidate text containing an alert id -> SKIP on scrub", () => {
  const dirty = { text: "Alert alt_9f2a1b3c4d5e showed the pattern." };
  const result = promotionGate(dirty, goodJudgment, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
});

test("candidate text containing an evidence ref -> SKIP on scrub", () => {
  const dirty = { text: "See ev_3ccbb856c343 for the raw log line." };
  const result = promotionGate(dirty, goodJudgment, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
});

test("no judgment at all -> SKIP on judge_error", () => {
  const result = promotionGate(goodCandidate, null, promoteConsensus);
  assert.strictEqual(result.decision, "SKIP");
  assert.ok(result.failed_gates.includes("judge_error"));
});

test("scrubIncidentIdentifiers: clean generic text passes", () => {
  const result = scrubIncidentIdentifiers("When <SERVICE> shows elevated latency, check its dependencies first.");
  assert.strictEqual(result.clean, true);
});

test("skillContentGate: admits an evidence-led heuristic", () => {
  const result = skillContentGate("When <SERVICE> shows a changed failure shape, compare fresh traces with the earlier incident before concluding recovery held.");
  assert.strictEqual(result.ok, true);
});

test("skillContentGate: rejects a hidden numeric alert rule", () => {
  const result = skillContentGate("When latency > 100, alert the responder.");
  assert.strictEqual(result.ok, false);
});

test("skillContentGate: rejects incident identifiers in a reusable body", () => {
  const result = skillContentGate("The inc_4a67dced536a response was the correct one.");
  assert.strictEqual(result.ok, false);
});

test("hasEvidencedDuplicateSearch: rejects missing field entirely", () => {
  assert.strictEqual(hasEvidencedDuplicateSearch({}), false);
});

test("hasEvidencedDuplicateSearch: rejects search items with empty query", () => {
  assert.strictEqual(hasEvidencedDuplicateSearch({ duplicate_search: [{ query: "", hits: 0 }] }), false);
});

test("hasEvidencedDuplicateSearch: accepts a real search", () => {
  assert.strictEqual(hasEvidencedDuplicateSearch({ duplicate_search: [{ query: "consumer lag", hits: 0 }] }), true);
});

console.log(`\n${passed} passed${process.exitCode ? ", with failures" : ""}.`);
