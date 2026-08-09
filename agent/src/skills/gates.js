// Pure gate functions — zero model calls, zero raw telemetry references.
//
// PLAN NOTE (PLAN-malleability-only-95.md §0/§5): every function here is only
// ever allowed to check properties an agent already judged and reported as
// structured output — never a raw telemetry value, never a numeric domain
// threshold, and never a vote count standing in for a judgment. The
// Consensus agent (see skills/author.js) is what has real veto power here;
// this file only verifies that its decision, and Judge's four gates, and a
// mechanical identifier scrub, all actually came back the way they must.

// Challenge/incident-specific identifiers a reusable skill must never carry.
// A learning that needs a specific incident/alert/evidence id to make sense
// is lore about this one incident, not a reusable pattern.
const IDENTIFIER_PATTERNS = [
  [/\binc_[0-9a-f]{6,}\b/i, "incident id"],
  [/\balt_[0-9a-f]{6,}\b/i, "alert id"],
  [/\bev_[0-9a-f]{6,}\b/i, "evidence ref"],
  [/\b[0-9a-f]{32}\b/i, "trace id"],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "literal timestamp"],
];

function scrubIncidentIdentifiers(text) {
  const hits = [];
  const str = String(text || "");
  for (const [pattern, label] of IDENTIFIER_PATTERNS) {
    if (pattern.test(str)) hits.push(label);
  }
  return { clean: hits.length === 0, hits };
}

// Structural check: an agent claiming "not already captured" must have
// actually searched for duplicates and reported what it found. An empty or
// missing search is treated as an unevidenced novelty claim, not as "true".
function hasEvidencedDuplicateSearch(judgment) {
  const search = judgment && judgment.duplicate_search;
  if (!Array.isArray(search) || search.length === 0) return false;
  return search.every((item) => item && typeof item.query === "string" && item.query.trim());
}

// The only place a candidate is promoted or not. Pure AND of already-decided
// agent judgments — no arithmetic, no vote count, no telemetry value.
function promotionGate(candidate, judgment, consensus) {
  const failed = [];

  if (!judgment) {
    return { decision: "SKIP", reason: "judge returned no result", failed_gates: ["judge_error"] };
  }

  if (!judgment.generalizable) failed.push("generalizable");
  if (!judgment.material) failed.push("material");
  if (!judgment.minimal_footprint) failed.push("minimal_footprint");
  if (!judgment.not_already_captured) failed.push("not_already_captured");

  const searched = hasEvidencedDuplicateSearch(judgment);
  if (judgment.not_already_captured && !searched) {
    failed.push("not_already_captured:unevidenced");
  }

  if (judgment.footprint === "new-file" && !String(judgment.no_host_reason || "").trim()) {
    failed.push("minimal_footprint:no_host_reason");
  }

  const scrub = scrubIncidentIdentifiers(candidate && candidate.text);
  if (!scrub.clean) failed.push(`generalizable:scrub(${scrub.hits.join(",")})`);

  if (failed.length) {
    return { decision: "SKIP", reason: failed.join(", "), failed_gates: failed };
  }

  // All four Judge gates and the structural checks hold. The only remaining
  // veto is the Consensus agent's own judgment — never a vote tally.
  if (!consensus || consensus.decision !== "PROMOTE") {
    return {
      decision: "REJECT",
      reason: (consensus && consensus.deciding_factor) || "consensus did not promote",
      failed_gates: [],
    };
  }

  return { decision: "PROMOTE", reason: "all gates hold; consensus promoted", failed_gates: [] };
}

module.exports = { scrubIncidentIdentifiers, hasEvidencedDuplicateSearch, promotionGate };
