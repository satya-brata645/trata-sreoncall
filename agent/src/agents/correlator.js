// Correlator agent — LLM call #2 (§7). Decides what the current picture of
// alerts actually means: new incident, symptom of one already open, a merge,
// a split, a re-severity, a resolution, or an escalation.
//
// PLAN NOTE: every one of those decisions is the model's judgment, made via
// tool calls below. This file's code only applies whatever the model
// decided to state.js and returns a list of "actions taken" so hooks (e.g.
// lifecycle) can react — it contains no correlation/grouping logic of its
// own (no `if (sameService && within5min)`, ever).
const crypto = require("crypto");
const llm = require("../llm");
const { INVESTIGATIVE_TOOLS, buildInvestigativeToolImpls } = require("./investigative-tools");

const SYSTEM_PROMPT = `You own the incident picture for this system. You are given the alerts currently live, the
incidents you have already declared, the reasoning you used when you declared them, and any
feature-flag changes in the same window.

Your job is to decide what is actually going on — not to file one incident per alert. Five
alerts across frontend, cart, and payment during one bad change is ONE incident with four
symptoms. Two unrelated faults at the same time are two incidents even though they overlap.

For each decision choose one:
  DECLARE     a new incident from one or more alerts
  ATTACH      an alert to an open incident, as another symptom
  MERGE       two incidents you now believe are the same thing
  SPLIT       an incident you now believe is two unrelated problems
  RESEVERITY  change severity based on new evidence
  RESOLVE     an incident whose evidence shows recovery
  ESCALATE    hand to a human — see below
  NOOP        not enough signal yet; say what you are waiting for

You will be wrong sometimes. When new evidence contradicts something you already published,
revise it explicitly: what you believed, what the new evidence is, what you believe now.
Silently changing your story is worse than being wrong. Quietly leaving a stale incident
open because you already declared it is worse still.

Never resolve because an alert stopped firing. Resolve only when you can point to evidence
of recovery in the target system, and state that evidence.

You may never propose muting an alert, dropping a log stream, narrowing a query to exclude
noisy data, or any action whose effect is that you can see less. If a signal is noisy, say
it is noisy and reason about it. Do not remove it.

Escalating is a successful outcome, not a failure. If something is genuinely ambiguous —
you cannot determine blast radius, cause, or whether two things are related — escalate with
a clean package of what you observed, what you ruled out, and what you need a human to
decide, rather than guessing confidently.

You have the same investigative tools triage used (query_logs, query_metric, search_traces,
etc.) — use them. Do not resolve an incident just because no new alert mentions it or because
a flag flipped back off; go check whether the evidence has actually changed before you
resolve, reseverity, or escalate anything.

You may call more than one tool across the alerts you're given. When you have addressed
every new alert (declared, attached, or explicitly deferred with NOOP) and reviewed every
open incident for possible resolution, stop and summarize what you did.

Important: taking an action means actually calling the corresponding tool (declare_incident,
resolve_incident, etc.) — describing what you would do in your text response, without calling
the tool, has no effect on the system and does not count as having acted. If you've decided
what to do, call the tool now rather than narrating it.`;

const ACTION_TOOLS = [
  {
    name: "declare_incident",
    description: "Open a new incident from one or more alerts that represent a single real problem.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        severity: { type: "string", enum: ["sev1", "sev2", "sev3", "sev4"] },
        headline: { type: "string", description: "2-3 lines max: what broke, who it affects, what you're doing." },
        blast_radius: { type: "string" },
        alert_ids: { type: "array", items: { type: "string" } },
        reasoning: { type: "string", description: "Why these alerts are one incident." },
      },
      required: ["title", "severity", "headline", "blast_radius", "alert_ids", "reasoning"],
    },
  },
  {
    name: "attach_alert",
    description: "Attach a new alert to an already-open incident as another symptom of the same problem.",
    input_schema: {
      type: "object",
      properties: {
        incident_id: { type: "string" },
        alert_id: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["incident_id", "alert_id", "reasoning"],
    },
  },
  {
    name: "merge_incidents",
    description: "Merge two or more open incidents you now believe are the same underlying problem. Requires a revision entry.",
    input_schema: {
      type: "object",
      properties: {
        incident_ids: { type: "array", items: { type: "string" }, minItems: 2 },
        new_title: { type: "string" },
        new_headline: { type: "string" },
        previously_believed: { type: "string" },
        new_evidence_refs: { type: "array", items: { type: "string" } },
        now_believes: { type: "string" },
        why_changed: { type: "string" },
      },
      required: ["incident_ids", "new_title", "new_headline", "previously_believed", "now_believes", "why_changed"],
    },
  },
  {
    name: "split_incident",
    description: "Split one incident into two or more because its alerts actually represent unrelated problems. Requires a revision entry.",
    input_schema: {
      type: "object",
      properties: {
        incident_id: { type: "string" },
        splits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              headline: { type: "string" },
              severity: { type: "string", enum: ["sev1", "sev2", "sev3", "sev4"] },
              blast_radius: { type: "string" },
              alert_ids: { type: "array", items: { type: "string" } },
            },
            required: ["title", "headline", "severity", "blast_radius", "alert_ids"],
          },
        },
        previously_believed: { type: "string" },
        now_believes: { type: "string" },
        why_changed: { type: "string" },
      },
      required: ["incident_id", "splits", "previously_believed", "now_believes", "why_changed"],
    },
  },
  {
    name: "reseverity_incident",
    description: "Change an open incident's severity based on new evidence. Requires a revision entry.",
    input_schema: {
      type: "object",
      properties: {
        incident_id: { type: "string" },
        new_severity: { type: "string", enum: ["sev1", "sev2", "sev3", "sev4"] },
        previously_believed: { type: "string" },
        new_evidence_refs: { type: "array", items: { type: "string" } },
        now_believes: { type: "string" },
        why_changed: { type: "string" },
      },
      required: ["incident_id", "new_severity", "previously_believed", "now_believes", "why_changed"],
    },
  },
  {
    name: "resolve_incident",
    description: "Resolve an incident. Must cite evidence of actual recovery — never just that alerts stopped firing.",
    input_schema: {
      type: "object",
      properties: {
        incident_id: { type: "string" },
        recovery_evidence_refs: { type: "array", items: { type: "string" }, minItems: 1 },
        previously_believed: { type: "string" },
        now_believes: { type: "string" },
        why_changed: { type: "string" },
      },
      required: ["incident_id", "recovery_evidence_refs", "previously_believed", "now_believes", "why_changed"],
    },
  },
  {
    name: "escalate_incident",
    description: "Hand an incident to a human. A successful outcome when something is genuinely ambiguous, not a failure.",
    input_schema: {
      type: "object",
      properties: {
        incident_id: { type: "string" },
        observed: { type: "string" },
        ruled_out: { type: "string" },
        could_not_determine: { type: "string" },
        needs_from_human: { type: "string" },
      },
      required: ["incident_id", "observed", "ruled_out", "could_not_determine", "needs_from_human"],
    },
  },
  {
    name: "noop",
    description: "Explicitly decide not to act yet on a specific alert or incident, and say what you're waiting for.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "alert_id or incident_id this applies to, or 'general'." },
        reasoning: { type: "string" },
        waiting_for: { type: "string" },
      },
        required: ["subject", "reasoning", "waiting_for"],
    },
  },
];

const TOOLS = [...INVESTIGATIVE_TOOLS, ...ACTION_TOOLS];

function nowIso() {
  return new Date().toISOString();
}

function buildToolImpls({ state, actionsTaken }) {
  function getIncident(id) {
    const inc = state.incidents[id];
    if (!inc) throw new Error(`No such incident: ${id}`);
    return inc;
  }
  function pushRevision(inc, action, fields) {
    inc.revisions = inc.revisions || [];
    inc.revisions.push({ at: nowIso(), action, ...fields });
  }

  return {
    ...buildInvestigativeToolImpls(),
    declare_incident: async (input) => {
      const id = `inc_${crypto.randomBytes(6).toString("hex")}`;
      const incident = {
        id,
        title: input.title,
        severity: input.severity,
        status: "open",
        headline: input.headline,
        blast_radius: input.blast_radius,
        alert_ids: input.alert_ids,
        reasoning: input.reasoning,
        declared_at: nowIso(),
        revisions: [],
      };
      state.incidents[id] = incident;
      for (const aid of input.alert_ids) {
        if (state.alerts[aid]) state.alerts[aid].status = "attached";
      }
      state.performance.alerts_that_became_incidents += input.alert_ids.length;
      for (const aid of input.alert_ids) {
        state.performance.detect_to_declare_log.push({
          alert_id: aid,
          incident_id: id,
          alert_first_seen: state.alerts[aid]?.first_seen || null,
          incident_declared_at: incident.declared_at,
        });
      }
      actionsTaken.push({ type: "incident.declared", incident_id: id });
      return { declared: true, incident_id: id };
    },

    attach_alert: async (input) => {
      const inc = getIncident(input.incident_id);
      if (!inc.alert_ids.includes(input.alert_id)) inc.alert_ids.push(input.alert_id);
      if (state.alerts[input.alert_id]) state.alerts[input.alert_id].status = "attached";
      state.performance.alerts_that_became_incidents += 1;
      actionsTaken.push({ type: "incident.revised", incident_id: input.incident_id, action: "ATTACH" });
      return { attached: true };
    },

    merge_incidents: async (input) => {
      const [primaryId, ...rest] = input.incident_ids;
      const primary = getIncident(primaryId);
      for (const otherId of rest) {
        const other = getIncident(otherId);
        primary.alert_ids = [...new Set([...primary.alert_ids, ...other.alert_ids])];
        other.status = "resolved";
        other.merged_into = primaryId;
      }
      primary.title = input.new_title;
      primary.headline = input.new_headline;
      pushRevision(primary, "MERGE", {
        previously_believed: input.previously_believed,
        new_evidence: input.new_evidence_refs || [],
        now_believes: input.now_believes,
        why_changed: input.why_changed,
      });
      actionsTaken.push({ type: "incident.revised", incident_id: primaryId, action: "MERGE" });
      return { merged: true, primary_incident_id: primaryId };
    },

    split_incident: async (input) => {
      const original = getIncident(input.incident_id);
      const newIds = [];
      for (const split of input.splits) {
        const id = `inc_${crypto.randomBytes(6).toString("hex")}`;
        state.incidents[id] = {
          id,
          title: split.title,
          severity: split.severity,
          status: "open",
          headline: split.headline,
          blast_radius: split.blast_radius,
          alert_ids: split.alert_ids,
          reasoning: `Split from ${input.incident_id}: ${input.why_changed}`,
          declared_at: nowIso(),
          revisions: [],
        };
        newIds.push(id);
      }
      original.status = "resolved";
      original.split_into = newIds;
      pushRevision(original, "SPLIT", {
        previously_believed: input.previously_believed,
        new_evidence: [],
        now_believes: input.now_believes,
        why_changed: input.why_changed,
      });
      actionsTaken.push({ type: "incident.revised", incident_id: input.incident_id, action: "SPLIT", new_incident_ids: newIds });
      return { split: true, new_incident_ids: newIds };
    },

    reseverity_incident: async (input) => {
      const inc = getIncident(input.incident_id);
      const previousSeverity = inc.severity;
      inc.severity = input.new_severity;
      pushRevision(inc, "RESEVERITY", {
        previously_believed: input.previously_believed || `severity was ${previousSeverity}`,
        new_evidence: input.new_evidence_refs || [],
        now_believes: input.now_believes,
        why_changed: input.why_changed,
      });
      actionsTaken.push({ type: "incident.revised", incident_id: input.incident_id, action: "RESEVERITY" });
      return { reseverity: true, from: previousSeverity, to: input.new_severity };
    },

    resolve_incident: async (input) => {
      const inc = getIncident(input.incident_id);
      inc.status = "resolved";
      inc.resolved_at = nowIso();
      pushRevision(inc, "RESOLVE", {
        previously_believed: input.previously_believed,
        new_evidence: input.recovery_evidence_refs,
        now_believes: input.now_believes,
        why_changed: input.why_changed,
      });
      state.performance.incidents_resolved += 1;
      actionsTaken.push({ type: "incident.resolved", incident_id: input.incident_id });
      return { resolved: true };
    },

    escalate_incident: async (input) => {
      const inc = getIncident(input.incident_id);
      inc.status = "escalated";
      inc.escalation = {
        at: nowIso(),
        observed: input.observed,
        ruled_out: input.ruled_out,
        could_not_determine: input.could_not_determine,
        needs_from_human: input.needs_from_human,
      };
      state.performance.incidents_escalated += 1;
      actionsTaken.push({ type: "incident.escalated", incident_id: input.incident_id });
      return { escalated: true };
    },

    noop: async (input) => {
      actionsTaken.push({ type: "noop", subject: input.subject, waiting_for: input.waiting_for });
      return { acknowledged: true };
    },
  };
}

// Runs one correlation pass. Mutates `state` in place (alerts/incidents),
// returns { actionsTaken, summary, callLog } for hooks and the surface.
async function runCorrelator({ state, newAlerts, recentFlagChanges }) {
  for (const alert of newAlerts) {
    state.alerts[alert.id] = alert;
  }
  state.performance.alerts_raised += newAlerts.length;

  const actionsTaken = [];
  const toolImpls = buildToolImpls({ state, actionsTaken });
  const toolCallLog = [];

  const openIncidents = Object.values(state.incidents).filter(
    (i) => i.status !== "resolved" && i.status !== "closed"
  );

  const userMessage = [
    `New alerts this pass:`,
    JSON.stringify(newAlerts, null, 2),
    ``,
    `All currently open incidents (with their reasoning and revision history so far):`,
    JSON.stringify(openIncidents, null, 2),
    ``,
    `Recent feature-flag changes (if any):`,
    JSON.stringify(recentFlagChanges || [], null, 2),
    ``,
    newAlerts.length === 0
      ? `No new alerts this pass. Review open incidents only: does any of them show evidence of recovery? Use resolve_incident if so, citing recovery evidence. Otherwise call noop.`
      : `Decide what each new alert means for the incident picture. Call the appropriate tools.`,
  ].join("\n");

  const { finalText, callLog } = await llm.runAgentLoop({
    model: llm.MODEL_STRONG,
    system: SYSTEM_PROMPT,
    userMessage,
    tools: TOOLS,
    toolImpls,
    maxTurns: 16,
    onToolCall: (entry) => toolCallLog.push({ at: nowIso(), ...entry }),
  });

  return { actionsTaken, summary: finalText, callLog, toolCallLog };
}

module.exports = { runCorrelator, SYSTEM_PROMPT, TOOLS };
