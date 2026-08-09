// The deep investigation loop. Unlike the reference platform's single tool-use round-trip
// (agent-orchestrator.service.ts), this runs multiple turns on purpose — the model can call
// read tools (query_metric/query_logs/search_error_traces/get_trace_spans) as many times as
// it wants to actually build a case, then must finish with exactly one terminal action:
// open_incident, update_incident, resolve_incident, or no_incident (a false-positive verdict).

const lgtm = require("./lgtm");
const baseline = require("./baseline");
const store = require("./store");
const playbooks = require("./playbooks");
const github = require("./github");
const { runToolLoop } = require("./openaiClient");
const { READ_TOOLS, INVESTIGATE_ACTION_TOOLS, dispatch } = require("./tools");

const TERMINAL_TOOLS = ["open_incident", "update_incident", "resolve_incident", "no_incident"];

// Every open incident is shown, not just one matching the flagged service. Investigations
// routinely start at a symptom (frontend erroring) and trace back to an origin that already
// has an incident (product-catalog) — without the full list the agent opens a duplicate for
// the same underlying fault, which it did before this was added.
function summarizeOpenIncidents(openIncidents) {
  if (!openIncidents || openIncidents.length === 0) return "(no incidents are currently open)";
  return openIncidents
    .map((inc) => {
      const last = inc.timeline[inc.timeline.length - 1];
      return [
        `- ${inc.id} [${inc.severity}] origin=${inc.service} affected=[${(inc.affectedServices || []).join(", ")}]`,
        `    root cause so far: ${last.rootCause || "(n/a)"} (confidence ${last.confidence ?? "n/a"})`,
      ].join("\n");
    })
    .join("\n");
}

async function investigate({ service, triageReason, triageConfidence, openIncidents = [] }) {
  const raw = await lgtm.getServiceDigest(service);
  const scored = baseline.scoreDigest(raw);
  const digestText = Object.entries(scored.metrics)
    .map(([m, s]) => `${m}: current=${s.current.toFixed(2)} z=${s.z} (baseline ${s.baselineMean.toFixed(2)}±${s.baselineStddev.toFixed(2)})`)
    .join("; ");

  const system = `You are the investigation layer of an SRE agent watching the OpenTelemetry Demo app.
Triage flagged "${service}" for you: "${triageReason}" (confidence ${triageConfidence}).

FIRST, call select_playbooks with the playbook(s) whose approach fits these symptoms. You'll get
back detailed diagnostic guidance — key signals, query patterns proven to work in this specific
deployment, and discriminators for telling similar fault classes apart. Available playbooks:
${playbooks.catalogSummary()}
Pick more than one if the symptoms span several classes. If the evidence later points somewhere
different from your first pick, call select_playbooks again — changing your mind based on new
evidence is expected, and the re-selection is recorded as part of the audit trail.

THEN use the read tools (query_metric, query_logs, search_error_traces, get_trace_spans,
list_related_services, list_metric_names) as many times as you need to actually build a case —
pull real PromQL values, real log lines, real trace IDs. Do not guess metric names; discover them
with list_metric_names, because services here are written in different languages and export
different metric families.

Every claim you make in a root cause must cite a literal query and the literal value/line it
returned — that's the evidence array's job. Consider whether the blast radius reaches other
services (check list_related_services / trace spans) before deciding severity, and prefer naming
the ORIGIN service over the loudest symptom.

When you're done gathering evidence, call exactly ONE of: open_incident, update_incident,
resolve_incident, or no_incident.

OWNERSHIP — this part is not optional. Whenever you open an incident (or revise one whose fix
you now understand) with confidence >= 0.7 and a fixType of 'code' or 'config', you MUST also
call propose_fix_pr in that same turn. Listing recommended actions is not ownership; a human
still has to do all the work. The PR is where you hand over something concrete and reviewable.
Write a real, specific artifact:
  - fixType 'config' -> a runbook at runbooks/<service>-<symptom>.md giving the exact remediation
    steps for THIS fault (the specific setting/flag/threshold, its current and intended value,
    how to verify recovery with the same query you cited), plus what to check first next time.
  - fixType 'code' -> the concrete change or a precise description of it at the right path,
    explaining what breaks without it.
Never write a generic runbook that would read the same for any incident — cite this incident's
actual metric values, trace IDs, and error text. The PR is opened as a DRAFT for human review
and is never merged automatically.

CURRENTLY OPEN INCIDENTS:
${summarizeOpenIncidents(openIncidents)}
Before opening anything new, check this list. If your investigation traces back to a service that
already has an open incident — even though triage flagged you a different service — that is the
SAME underlying fault: call update_incident on the existing ID (adding the newly-affected service
to affectedServices) instead of opening a duplicate. Open a new incident only when the root cause
is genuinely distinct from every incident listed above.`;

  const userMessage = `Current signal digest for ${service} (z-scores vs its own trailing 30-minute baseline):\n${digestText}\n\nInvestigate and decide.`;

  const result = await runToolLoop({
    system,
    userMessage,
    tools: [...READ_TOOLS, ...INVESTIGATE_ACTION_TOOLS],
    dispatch,
    terminalToolNames: TERMINAL_TOOLS,
    maxTurns: 10,
  });

  // Record which playbooks the model chose (and why) on the incident itself, so `show.js`
  // can display how the investigation was approached — including any mid-course re-selection.
  const selections = result.toolCallLog
    .filter((c) => c.name === "select_playbooks")
    .map((c) => ({ playbookIds: c.args.playbookIds, reasoning: c.args.reasoning }));
  result.playbookSelections = selections;

  const incidentId = result.terminal?.result?.id;
  if (incidentId && selections.length) {
    try {
      store.attachInvestigationMeta(incidentId, { playbookSelections: selections });
    } catch {
      // Metadata is a nice-to-have; never let it break a real investigation result.
    }
  }

  // Now that the incident actually exists, open the draft PR the model queued during the loop.
  let queued = result.toolCallLog.find((c) => c.name === "propose_fix_pr")?.result?.proposal;

  // Asking for the terminal action and the fix proposal in one turn is unreliable — the model
  // reliably does the first and drops the second. So once an incident is recorded with an
  // actionable fix, ownership is enforced with a dedicated follow-up call that can only
  // produce the fix artifact. The content is still entirely the model's.
  const terminalName = result.terminal?.name;
  const terminalArgs = result.terminal?.args || {};
  // update_incident may omit fixType (it's optional there), so fall back to what the incident
  // already recorded — otherwise revisions silently skip the ownership step.
  const effectiveFixType = terminalArgs.fixType || (incidentId ? store.get(incidentId)?.fixType : undefined);
  const wantsFix =
    ["open_incident", "update_incident"].includes(terminalName) &&
    ["code", "config"].includes(effectiveFixType) &&
    (terminalArgs.confidence ?? 0) >= 0.7;

  if (!queued && wantsFix) {
    const proposeTool = INVESTIGATE_ACTION_TOOLS.filter((t) => t.function.name === "propose_fix_pr");
    try {
      const fixRun = await runToolLoop({
        system: `You already established the root cause of an incident. Now produce the concrete fix artifact — a
draft PR a human can review. It must be specific to THIS incident: cite its actual metric values,
trace IDs, and error text. A runbook that would read identically for any other incident is not
acceptable. For fixType 'config', write runbooks/<service>-<symptom>.md with the exact remediation
(which setting/flag, current vs intended value, the literal query to verify recovery). For 'code',
describe the precise change and what breaks without it.`,
        userMessage: `Incident: ${terminalArgs.title || terminalArgs.revisionReason}
Origin service: ${terminalArgs.service || service}
Fix type: ${effectiveFixType}
Root cause: ${terminalArgs.rootCause}
Evidence: ${JSON.stringify(terminalArgs.evidence || [])}
Recommended actions: ${JSON.stringify(terminalArgs.recommendedActions || [])}

Call propose_fix_pr now.`,
        tools: proposeTool,
        dispatch,
        terminalToolNames: ["propose_fix_pr"],
        maxTurns: 1,
      });
      queued = fixRun.terminal?.result?.proposal;
      result.toolCallLog.push(...fixRun.toolCallLog);
    } catch (err) {
      result.fixProposalError = err.message;
    }
  }
  // One incident gets revised many times as new symptoms trace back to it; without this guard
  // each revision would open another PR for the same underlying fix.
  const alreadyHasPr = incidentId ? Boolean(store.get(incidentId)?.prUrl) : false;
  if (queued && incidentId && !alreadyHasPr) {
    try {
      const url = await github.proposeFixPr({
        incidentId,
        service: queued.service,
        title: queued.title,
        body: `${queued.body}\n\n---\nProposed automatically by the SREonCall agent for incident ${incidentId}. Draft only — not merged.`,
        files: [{ relPath: queued.fileRelPath, content: queued.fileContent }],
      });
      store.setPrUrl(incidentId, url);
      result.prUrl = url;
    } catch (err) {
      // A failed PR must never sink a valid investigation — record the proposed content on
      // the incident instead, so the recommendation survives even without a live PR.
      store.appendTimeline(incidentId, {
        type: "fix_proposal_recorded",
        note: `Draft PR could not be opened (${err.message}). Proposed fix content preserved below.`,
        proposedFile: queued.fileRelPath,
        proposedContent: queued.fileContent,
      });
      result.prError = err.message;
    }
  }

  return result;
}

module.exports = { investigate, TERMINAL_TOOLS };
