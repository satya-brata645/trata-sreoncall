// Self-authoring loop — the verified pipeline (PLAN-malleability-only-95.md).
// Fires on incident.resolved.
//
// PLAN NOTE: no single agent decides alone whether a skill gets promoted.
// HARVEST proposes, JUDGE investigates with a real search tool, REFUTE (3
// independent, blind, ALWAYS run) tries to kill it, CONSENSUS reads all of
// that verbatim and rules, and GATE (pure code, src/skills/gates.js) applies
// a formal AND of already-decided judgments — no vote tally, no telemetry
// threshold, ever. See gates.js's own header comment for the exact
// boundary this file must not cross.
const fs = require("fs");
const path = require("path");
const llm = require("../llm");
const loader = require("./loader");
const gates = require("./gates");
const { searchSkills } = require("./search");

const SEARCH_SKILLS_TOOL = {
  name: "search_skills",
  description: "Search the existing skill library (base + learned) for a term. Returns matching skill names and a snippet.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

function buildSearchToolImpl(callLog) {
  return {
    search_skills: async ({ query }) => {
      const results = searchSkills(query);
      callLog.push({ query, hitCount: results.length, results });
      return { query, hit_count: results.length, results };
    },
  };
}

// ---------------------------------------------------------------- HARVEST --

const HARVEST_TOOL = {
  name: "report_candidates",
  description: "Report candidate reusable heuristics learned from this incident.",
  input_schema: {
    type: "object",
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", description: "A 'When <symptom>, <approach>' pattern. Placeholders only — <SERVICE>, <FLAG_NAME>, <METRIC_NAME>. Never this incident's specific ids." },
          },
        },
      },
    },
  },
};

const HARVEST_SYSTEM = `You just finished handling an incident. Reflect honestly on what you learned that would help
you handle THIS SYSTEM faster or better next time — not generic SRE advice, something
specific to what you actually observed here.

Propose a candidate only for something concrete and reusable. Frame each as "When <symptom>,
<approach>" using placeholders (<SERVICE>, <FLAG_NAME>, <METRIC_NAME>) — never this incident's
specific id, alert id, or evidence ref; those make it lore about one incident, not a skill
future-you can use. If truly nothing new was learned, return an empty candidates array —
proposing something isn't required, and a bad candidate wastes the judging pipeline's time.`;

async function harvest({ incident, alerts }) {
  const userMessage = [
    `Incident just resolved:`,
    JSON.stringify(incident, null, 2),
    ``,
    `Its alerts:`,
    JSON.stringify(alerts, null, 2),
  ].join("\n");

  const result = await llm.callForStructuredOutput({
    model: llm.MODEL_STRONG,
    system: HARVEST_SYSTEM,
    userMessage,
    tool: HARVEST_TOOL,
  });
  return Array.isArray(result.candidates) ? result.candidates : [];
}

// ------------------------------------------------------------------ JUDGE --

const JUDGE_TOOL = {
  name: "report_judgment",
  description: "Report your promotion judgment for this candidate.",
  input_schema: {
    type: "object",
    required: ["generalizable", "material", "not_already_captured", "minimal_footprint", "footprint"],
    properties: {
      generalizable: { type: "boolean", description: "Reusable pattern, not incident-specific lore." },
      material: { type: "boolean", description: "Would actually change future triage, not something a competent agent already does via existing skills." },
      not_already_captured: { type: "boolean", description: "True only if your searches did NOT find an existing skill already covering this." },
      minimal_footprint: { type: "boolean" },
      footprint: { type: "string", enum: ["extend", "new-file"] },
      no_host_reason: { type: "string", description: "REQUIRED when footprint is new-file: which existing skills you considered and why none can host this." },
      proposed_target: { type: "string", description: "Existing skill name to extend, or a new kebab-case name." },
      reasoning: { type: "string" },
    },
  },
};

const JUDGE_SYSTEM = `You decide whether ONE candidate learning may enter the shared skill library. Use the
search_skills tool to actually search for duplicates before concluding anything — searching
at least twice, with different terms, before you decide not_already_captured. A candidate you
haven't searched for is a candidate you can't honestly call novel.

Apply four gates, all required to promote:
  GENERALIZABLE — a reusable pattern, not target/incident-specific lore.
  MATERIAL — adds real coverage or speed for FUTURE incidents; "a competent agent already
             does this via an existing skill" fails this gate.
  NOT_ALREADY_CAPTURED — only true if your searches came back empty or clearly distinct.
  MINIMAL_FOOTPRINT — prefer extending an existing skill's body over a new file. A new file
             requires naming the existing skills you considered and why none could host this.

Do not write anything. Only judge.`;

async function judgeCandidate(candidate) {
  const searchLog = [];
  const investigation = await llm.runAgentLoop({
    model: llm.MODEL_STRONG,
    system: JUDGE_SYSTEM,
    userMessage: `Candidate: ${candidate.text}`,
    tools: [SEARCH_SKILLS_TOOL],
    toolImpls: buildSearchToolImpl(searchLog),
    maxTurns: 6,
  });

  const judgment = await llm.callForStructuredOutput({
    model: llm.MODEL_FAST,
    system: "Structure the investigation below into the required judgment report. Do not add or remove substance.",
    userMessage: investigation.finalText,
    tool: JUDGE_TOOL,
  });

  // The duplicate_search trail is attached from the ACTUAL tool calls made,
  // not the model's self-transcription — gates.js's hasEvidencedDuplicateSearch
  // checks ground truth, so a candidate can't be waved through by a judge that
  // merely claims to have searched. If the judge never called the tool, this
  // is legitimately empty, and the gate correctly rejects on that basis.
  judgment.duplicate_search = searchLog.map((s) => ({
    query: s.query,
    hits: s.hitCount,
    closest: s.results[0] ? s.results[0].name : null,
  }));

  return judgment;
}

// ----------------------------------------------------------------- REFUTE --

const REFUTE_TOOL = {
  name: "report_refutation",
  description: "Report whether you could kill this promotion.",
  input_schema: {
    type: "object",
    required: ["refuted", "reason"],
    properties: {
      refuted: { type: "boolean" },
      gate: { type: "string", enum: ["generalizable", "material", "not_already_captured", "minimal_footprint", ""] },
      reason: { type: "string" },
      duplicate_at: { type: "string", description: "Skill name + quoted line, when refuting on not_already_captured." },
    },
  },
};

const REFUTE_SYSTEM = `You are an independent, blind reviewer. You are given a candidate learning and told nothing
about what any other reviewer concluded. Try hard to KILL its promotion into the shared skill
library. Default to skepticism.

Use the search_skills tool yourself — do not take the candidate's novelty on faith. Break
exactly ONE gate and say which:
  generalizable   — it's target/incident-specific lore, not a reusable pattern
  material        — any competent agent already does this
  not_already_captured — you found it already covered; CITE the skill and quote the line
  minimal_footprint — it should extend an existing skill instead of becoming new content

If you genuinely cannot find a problem after searching, say so plainly — a refuter who always
finds something isn't independent, just contrarian.`;

async function refuteCandidate(candidate, index) {
  const searchLog = [];
  const investigation = await llm.runAgentLoop({
    model: llm.MODEL_STRONG,
    system: REFUTE_SYSTEM,
    userMessage: `Candidate: ${candidate.text}`,
    tools: [SEARCH_SKILLS_TOOL],
    toolImpls: buildSearchToolImpl(searchLog),
    maxTurns: 5,
  });

  const verdict = await llm.callForStructuredOutput({
    model: llm.MODEL_FAST,
    system: "Structure the review below into the required refutation report.",
    userMessage: investigation.finalText,
    tool: REFUTE_TOOL,
  });
  return { refuter: index, ...verdict, searched: searchLog.map((s) => s.query) };
}

// -------------------------------------------------------------- CONSENSUS --

const CONSENSUS_TOOL = {
  name: "report_consensus",
  description: "Rule PROMOTE or REJECT after weighing the reviewers' actual arguments.",
  input_schema: {
    type: "object",
    required: ["decision", "reasoning", "deciding_factor"],
    properties: {
      decision: { type: "string", enum: ["PROMOTE", "REJECT"] },
      reasoning: { type: "string" },
      deciding_factor: { type: "string", description: "The single argument or citation that actually decided this — never a vote count." },
    },
  },
};

const CONSENSUS_SYSTEM = `You are given a candidate learning, the Judge's verdict, and three independent blind
reviewers' full arguments. Decide PROMOTE or REJECT by weighing the SUBSTANCE of what was
said — never by counting how many reviewers objected.

A single reviewer with a concrete, checkable citation (an exact existing skill and quoted
line showing this is already captured) should outweigh two reviewers who raised a vague or
unsupported concern. A unanimous "looks fine" with no real scrutiny is weaker evidence than
one sharp, well-cited kill. If a reviewer's citation names a skill that doesn't actually
exist in the list you're given, that citation is fabricated and carries no weight — say so.

State the ONE deciding factor plainly. "2 of 3 objected" is not an acceptable answer.`;

async function consensusDecide({ candidate, judgment, refuteVotes, existingSkillNames }) {
  const userMessage = [
    `Candidate: ${candidate.text}`,
    ``,
    `Judge's verdict: ${JSON.stringify(judgment, null, 2)}`,
    ``,
    `Actual skills that exist right now (for checking citations): ${existingSkillNames.join(", ")}`,
    ``,
    `Three independent reviewers' full verdicts:`,
    JSON.stringify(refuteVotes, null, 2),
  ].join("\n");

  return llm.callForStructuredOutput({
    model: llm.MODEL_STRONG,
    system: CONSENSUS_SYSTEM,
    userMessage,
    tool: CONSENSUS_TOOL,
  });
}

// ---------------------------------------------------------------- AUTHOR --

const AUTHOR_TOOL = {
  name: "write_content",
  description: "Produce the exact skill content to write.",
  input_schema: {
    type: "object",
    required: ["name", "description", "body", "creates_file"],
    properties: {
      name: { type: "string", description: "kebab-case" },
      description: { type: "string", description: "One line — all a future you sees when choosing whether to load it." },
      body: { type: "string", description: "Investigative heuristic. NOT a threshold, NOT a fixed procedure." },
      creates_file: { type: "boolean" },
      revises_existing: { type: "string", description: "Name of the skill being revised, when not creates_file." },
    },
  },
};

const AUTHOR_SYSTEM = `Write the EXACT skill content for an already-approved candidate. You do not decide whether to
write — that decision is made. Write investigative heuristics for judgment, never a threshold
("if X > N") and never a fixed procedure. Use placeholders, never this incident's specific ids.`;

async function authorContent({ candidate, judgment }) {
  const userMessage = [
    `Approved candidate: ${candidate.text}`,
    `Footprint: ${judgment.footprint} (target: ${judgment.proposed_target || "unspecified"})`,
  ].join("\n");

  return llm.callForStructuredOutput({
    model: llm.MODEL_STRONG,
    system: AUTHOR_SYSTEM,
    userMessage,
    tool: AUTHOR_TOOL,
  });
}

// ------------------------------------------------------------- WRITE/VERIFY --

function writeSkillFile({ name, description, body, origin, learnedFrom, evidenceRefs, timesApplied }) {
  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `origin: ${origin}`,
    learnedFrom ? `learned_from: ${learnedFrom}` : null,
    evidenceRefs && evidenceRefs.length ? `evidence_refs: [${evidenceRefs.join(", ")}]` : null,
    `times_applied: ${timesApplied || 0}`,
    "---",
    "",
    body.trim(),
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const filePath = path.join(loader.LEARNED_DIR, `${name}.md`);
  fs.writeFileSync(filePath, frontmatter);
  return filePath;
}

function writeAndVerify({ authored, incident, evidenceRefs }) {
  const existing = loader.loadByName(authored.name);
  if (authored.creates_file && existing) {
    return { written: false, reason: `name collision: "${authored.name}" already exists (origin: ${existing.origin})` };
  }
  if (!authored.creates_file && !existing) {
    return { written: false, reason: `revises_existing names "${authored.name}" but no such skill exists` };
  }

  const filePath = writeSkillFile({
    name: authored.name,
    description: authored.description,
    body: authored.body,
    origin: "learned",
    learnedFrom: incident.id,
    evidenceRefs,
    timesApplied: existing ? existing.times_applied : 0,
  });

  const roundTrip = loader.loadByName(authored.name);
  if (!roundTrip || roundTrip.description !== authored.description) {
    fs.unlinkSync(filePath);
    return { written: false, reason: "round-trip verification failed; write deleted" };
  }
  return { written: true, path: filePath, name: authored.name };
}

// --------------------------------------------------------------- PIPELINE --

// Runs the full verified pipeline for one resolved incident. Returns both
// the fields run.js already relies on (actionsTaken, summary) and the full
// trail for capturing as learning-trail.json.
async function reflect({ incident, alerts }) {
  const evidenceRefs = alerts.flatMap((a) => (a.evidence || []).map((e) => e.evidence_ref));
  const candidates = await harvest({ incident, alerts });

  const actionsTaken = [];
  const trailCandidates = [];

  if (!candidates.length) {
    actionsTaken.push({ type: "skill.none", reasoning: "harvest proposed no candidates" });
    return {
      actionsTaken,
      summary: "No candidates harvested from this incident — nothing to judge.",
      trail: { candidates: [] },
    };
  }

  for (const candidate of candidates) {
    const judgment = await judgeCandidate(candidate);

    // REFUTE always runs — never short-circuited by the Judge's verdict, so
    // it's always a genuine check, never decoration on the promote path only.
    const refuteVotes = await Promise.all([0, 1, 2].map((i) => refuteCandidate(candidate, i)));

    const existingSkillNames = loader.listDescriptions().map((s) => s.name);
    const consensus = await consensusDecide({ candidate, judgment, refuteVotes, existingSkillNames });

    const gateDecision = gates.promotionGate(candidate, judgment, consensus);

    let authored = null;
    let writeResult = null;
    if (gateDecision.decision === "PROMOTE") {
      authored = await authorContent({ candidate, judgment });
      writeResult = writeAndVerify({ authored, incident, evidenceRefs });
      actionsTaken.push(
        writeResult.written
          ? { type: "skill.promoted", name: writeResult.name }
          : { type: "skill.rejected", name: authored.name, reason: writeResult.reason }
      );
    } else {
      actionsTaken.push({ type: "skill.skipped", reason: gateDecision.reason, decision: gateDecision.decision });
    }

    trailCandidates.push({ candidate, judgment, refute_votes: refuteVotes, consensus, gate_decision: gateDecision, authored, write_result: writeResult });
  }

  const promotedCount = trailCandidates.filter((c) => c.write_result && c.write_result.written).length;
  const summary = promotedCount
    ? `Promoted ${promotedCount} of ${candidates.length} candidate(s) after judge+refute+consensus review.`
    : `Reviewed ${candidates.length} candidate(s); none passed the full promotion pipeline.`;

  return { actionsTaken, summary, trail: { candidates: trailCandidates } };
}

module.exports = { reflect, harvest, judgeCandidate, refuteCandidate, consensusDecide, authorContent, writeAndVerify };
