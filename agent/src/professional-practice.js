// Continuous professional practice. The on-call agent does not ship fixes,
// so this module never claims that it did. Instead it follows a resolved
// incident forward: did recovery hold, did a comparable failure recur, and
// did the evidence justify creating or refining a reusable playbook?
//
// Every conclusion below is an agent-authored, evidence-cited judgment. Code
// schedules reviews, preserves provenance, and validates writes; it never
// decides that a recovery held or that two incidents are the same pattern.
const fs = require("fs");
const path = require("path");
const llm = require("./llm");
const loader = require("./skills/loader");
const { skillContentGate } = require("./skills/gates");
const { INVESTIGATIVE_TOOLS, buildInvestigativeToolImpls } = require("./agents/investigative-tools");

const FOLLOW_UP_ITERATIONS = 3;

function ensurePractice(state) {
  state.performance = state.performance || {};
  state.performance.skill_application_log = state.performance.skill_application_log || [];
  state.practice = state.practice || {};
  state.practice.follow_ups = state.practice.follow_ups || [];
  state.practice.playbooks = state.practice.playbooks || [];
}

function replaceFrontmatterValue(raw, key, value) {
  const line = `${key}: ${value}`;
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(raw)) return raw.replace(pattern, line);
  return raw.replace(/^---\n([\s\S]*?)\n---/, (_match, frontmatter) => `---\n${frontmatter}\n${line}\n---`);
}

function incrementSkillUsage(skill) {
  if (!skill || !skill._dir || !skill._filename) return false;
  const filePath = path.join(skill._dir, skill._filename);
  const raw = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(filePath, replaceFrontmatterValue(raw, "times_applied", (skill.times_applied || 0) + 1));
  return true;
}

// Only count a skill application when the agent both loaded the skill and
// cited it on an alert. This prevents a model from inflating its own record
// by merely naming a skill in prose.
function recordSkillApplications({ state, alerts, loadedSkillNames }) {
  ensurePractice(state);
  const loaded = new Set(loadedSkillNames || []);
  const recorded = [];
  for (const alert of alerts || []) {
    for (const name of new Set(alert.skills_applied || [])) {
      if (!loaded.has(name)) continue;
      if (state.performance.skill_application_log.some((entry) => entry.alert_id === alert.id && entry.skill_name === name)) continue;
      const skill = loader.loadByName(name);
      if (!skill || !incrementSkillUsage(skill)) continue;
      const entry = { at: new Date().toISOString(), skill_name: name, alert_id: alert.id, incident_id: null, outcome: "awaiting-resolution" };
      state.performance.skill_application_log.push(entry);
      recorded.push(entry);
    }
  }
  return recorded;
}

function scheduleResolvedIncident({ state, incident }) {
  ensurePractice(state);
  if (!incident || !incident.id || state.practice.follow_ups.some((item) => item.incident_id === incident.id)) return null;
  const incidentAlertIds = new Set(incident.alert_ids || []);
  const sourceSkills = state.performance.skill_application_log
    .filter((entry) => incidentAlertIds.has(entry.alert_id))
    .map((entry) => {
      entry.incident_id = incident.id;
      return entry.skill_name;
    });
  const followUp = {
    incident_id: incident.id,
    review_count: 0,
    reviews_remaining: FOLLOW_UP_ITERATIONS,
    last_checked_sweep: state.performance.sweeps_run || 0,
    source_skill_names: [...new Set(sourceSkills)],
    reviews: [],
  };
  state.practice.follow_ups.push(followUp);
  return followUp;
}

const REVIEW_TOOL = {
  name: "report_practice_review",
  description: "Report an evidence-backed professional-practice follow-up review.",
  input_schema: {
    type: "object",
    required: ["recovery_status", "repeated_pattern", "recurrence_incident_ids", "evidence_refs", "finding", "playbook_action"],
    properties: {
      recovery_status: { type: "string", enum: ["held", "recurred", "inconclusive"] },
      repeated_pattern: { type: "boolean", description: "Your qualitative judgment whether the evidence represents a reusable repeated pattern." },
      recurrence_incident_ids: { type: "array", items: { type: "string" } },
      evidence_refs: { type: "array", items: { type: "string" }, description: "Only evidence refs returned by tools in this review." },
      finding: { type: "string", description: "What held, what returned, or why the result remains inconclusive." },
      playbook_action: { type: "string", enum: ["none", "create", "revise"] },
      proposed_playbook_name: { type: "string", description: "Kebab-case when a playbook should be created or revised." },
    },
  },
};

const REVIEW_SYSTEM = `You are performing a later, evidence-led professional-practice review of a resolved SRE incident.
The on-call system detects and triages; it did not itself apply a remediation. Do not claim a
fix was deployed. Your narrow job is to check whether the observed recovery has held, whether
a comparable incident has recurred, and whether the evidence now supports a reusable playbook.

Use the telemetry tools before deciding. Treat the prior incident and its resolution evidence
as context, not proof that recovery held. A later incident is comparable only when the actual
failure shape and evidence support that judgment; incident titles or service names alone are
not enough. Cite only evidence refs returned in this review. If evidence is thin, report
inconclusive rather than manufacturing a reassuring answer.

Recommend a create/revise playbook only when you judge a repeated, reusable operational
pattern is actually present. A playbook must capture how to investigate and verify, never
hardcoded alert thresholds, fixed severity mappings, or identifiers from one incident.`;

const PLAYBOOK_TOOL = {
  name: "write_playbook",
  description: "Write the exact reusable professional-practice playbook body for an approved evidence-backed review.",
  input_schema: {
    type: "object",
    required: ["name", "description", "body"],
    properties: {
      name: { type: "string", description: "kebab-case; use the approved proposed name." },
      description: { type: "string", description: "One line for future skill selection." },
      body: { type: "string", description: "Reusable investigation and verification playbook, with placeholders and no incident identifiers." },
    },
  },
};

const PLAYBOOK_SYSTEM = `Write a concise operational playbook from an evidence-backed review that already decided a
reusable pattern exists. Do not restate incident identifiers, timestamps, trace IDs, or raw
evidence. Include: what to notice, how to investigate and disconfirm, how to verify recovery
later, and what to record for future recurrence comparison. This is guidance, not a rigid
procedure: do not introduce numeric thresholds or fixed severity mappings.`;

function validReviewEvidence(review, toolCallLog) {
  const observedRefs = new Set(
    (toolCallLog || []).map((entry) => entry.output && entry.output.evidence_ref).filter(Boolean)
  );
  return [...new Set(review.evidence_refs || [])].filter((ref) => observedRefs.has(ref));
}

function writePlaybook({ authored, review, sourceIncidentIds }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(authored.name || "")) {
    return { written: false, reason: "playbook name is not kebab-case" };
  }
  const contentCheck = skillContentGate(authored.body);
  if (!contentCheck.ok) return { written: false, reason: `playbook content rejected: ${contentCheck.reason}` };

  const existing = loader.loadByName(authored.name);
  if (existing && existing.origin !== "professional-practice") {
    return { written: false, reason: `name collision with ${existing.origin} skill` };
  }

  const filePath = path.join(loader.LEARNED_DIR, `${authored.name}.md`);
  const frontmatter = [
    "---",
    `name: ${authored.name}`,
    `description: ${authored.description}`,
    "origin: professional-practice",
    "kind: playbook",
    `learned_from: [${sourceIncidentIds.join(", ")}]`,
    `evidence_refs: [${review.evidence_refs.join(", ")}]`,
    `times_applied: ${existing ? existing.times_applied : 0}`,
    `times_verified: ${existing ? Number(existing.times_verified || 0) + 1 : 1}`,
    `last_reviewed_at: ${new Date().toISOString()}`,
    "---",
    "",
    authored.body.trim(),
    "",
  ].join("\n");
  fs.writeFileSync(filePath, frontmatter);

  const roundTrip = loader.loadByName(authored.name);
  if (!roundTrip || roundTrip.description !== authored.description || roundTrip.body !== authored.body.trim()) {
    fs.unlinkSync(filePath);
    return { written: false, reason: "playbook round-trip verification failed; write deleted" };
  }
  return { written: true, name: authored.name, path: filePath, action: existing ? "revised" : "created" };
}

async function runNextFollowUp(state) {
  ensurePractice(state);
  const currentSweep = state.performance.sweeps_run || 0;
  const followUp = state.practice.follow_ups.find(
    (item) => item.reviews_remaining > 0 && item.last_checked_sweep < currentSweep
  );
  if (!followUp) return null;

  const incident = state.incidents[followUp.incident_id];
  if (!incident) {
    followUp.reviews_remaining = 0;
    return { skipped: true, reason: "original incident no longer exists", incident_id: followUp.incident_id };
  }
  const relatedIncidents = Object.values(state.incidents)
    .filter((candidate) => candidate.id !== incident.id)
    .map((candidate) => ({ id: candidate.id, title: candidate.title, status: candidate.status, headline: candidate.headline, reasoning: candidate.reasoning, declared_at: candidate.declared_at, resolved_at: candidate.resolved_at }));
  const toolCallLog = [];
  const investigation = await llm.runAgentLoop({
    model: llm.MODEL_STRONG,
    system: REVIEW_SYSTEM,
    userMessage: [
      `Resolved incident under follow-up: ${JSON.stringify(incident, null, 2)}`,
      `Skills actually loaded and cited on its alerts: ${JSON.stringify(followUp.source_skill_names)}`,
      `Prior follow-up reviews: ${JSON.stringify(followUp.reviews)}`,
      `Other incident summaries; cite an id only if evidence supports a recurrence: ${JSON.stringify(relatedIncidents)}`,
      `Professional-practice skills available: ${JSON.stringify(loader.listDescriptions().filter((skill) => skill.origin === "professional-practice"))}`,
    ].join("\n\n"),
    tools: INVESTIGATIVE_TOOLS,
    toolImpls: buildInvestigativeToolImpls(),
    maxTurns: 5,
    onToolCall: (entry) => toolCallLog.push({ at: new Date().toISOString(), ...entry }),
  });
  const review = await llm.callForStructuredOutput({
    model: llm.MODEL_FAST,
    system: "Structure this investigation into the required review. Do not add claims or evidence that were not in the investigation.",
    userMessage: investigation.finalText,
    tool: REVIEW_TOOL,
  });
  review.evidence_refs = validReviewEvidence(review, toolCallLog);
  review.recurrence_incident_ids = (review.recurrence_incident_ids || []).filter((id) => state.incidents[id] && id !== incident.id);
  const reviewRecord = { at: new Date().toISOString(), sequence: followUp.review_count + 1, ...review };
  followUp.reviews.push(reviewRecord);
  followUp.review_count += 1;
  followUp.reviews_remaining -= 1;
  followUp.last_checked_sweep = currentSweep;

  const incidentAlertIds = new Set(incident.alert_ids || []);
  for (const entry of state.performance.skill_application_log) {
    if (incidentAlertIds.has(entry.alert_id)) entry.outcome = review.recovery_status;
  }

  let playbook = null;
  // The model's qualitative decision is necessary but not sufficient: an
  // automatic playbook must also carry evidence observed in this exact review.
  if (review.repeated_pattern && review.playbook_action !== "none" && review.evidence_refs.length) {
    const authored = await llm.callForStructuredOutput({
      model: llm.MODEL_STRONG,
      system: PLAYBOOK_SYSTEM,
      userMessage: [
        `Approved action: ${review.playbook_action}`,
        `Required name: ${review.proposed_playbook_name || ""}`,
        `Review finding: ${review.finding}`,
        `Review evidence refs (provenance only; never put these IDs in the body): ${review.evidence_refs.join(", ")}`,
      ].join("\n"),
      tool: PLAYBOOK_TOOL,
    });
    if (review.proposed_playbook_name && authored.name !== review.proposed_playbook_name) {
      playbook = { written: false, reason: "author changed the approved playbook name" };
    } else {
      const sourceIncidentIds = [...new Set([incident.id, ...review.recurrence_incident_ids])];
      playbook = writePlaybook({ authored, review, sourceIncidentIds });
      if (playbook.written) {
        const existingRecord = state.practice.playbooks.find((item) => item.skill_name === playbook.name);
        if (existingRecord) {
          existingRecord.source_incident_ids = [...new Set([...existingRecord.source_incident_ids, ...sourceIncidentIds])];
          existingRecord.revisions.push({ at: reviewRecord.at, action: playbook.action, recovery_status: review.recovery_status });
        } else {
          state.practice.playbooks.push({ skill_name: playbook.name, source_incident_ids: sourceIncidentIds, created_at: reviewRecord.at, revisions: [{ at: reviewRecord.at, action: playbook.action, recovery_status: review.recovery_status }] });
        }
      }
    }
  }
  return { incident_id: incident.id, review: reviewRecord, playbook, reviews_remaining: followUp.reviews_remaining, toolCallLog };
}

module.exports = {
  FOLLOW_UP_ITERATIONS,
  ensurePractice,
  recordSkillApplications,
  scheduleResolvedIncident,
  validReviewEvidence,
  writePlaybook,
  runNextFollowUp,
};
