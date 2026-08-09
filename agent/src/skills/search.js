// Mechanical duplicate-search over the skill library — plain text matching,
// no model call. This is the tool Judge and Refute agents call to produce a
// REAL duplicate_search trail instead of a claimed one (PLAN-malleability-
// only-95.md §3: "an empty duplicate_search is treated as an unevidenced
// novelty claim and rejects the candidate").
const loader = require("./loader");

function searchSkills(query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [];
  const hits = [];
  for (const { dir, filename } of loader.listAllSkillFiles()) {
    const skill = loader.readSkillFile(dir, filename);
    const haystack = `${skill.name}\n${skill.description}\n${skill.body}`.toLowerCase();
    const idx = haystack.indexOf(q);
    if (idx === -1) continue;
    const snippetStart = Math.max(0, idx - 40);
    hits.push({
      name: skill.name,
      origin: skill.origin,
      snippet: haystack.slice(snippetStart, idx + q.length + 40).trim(),
    });
  }
  return hits;
}

module.exports = { searchSkills };
