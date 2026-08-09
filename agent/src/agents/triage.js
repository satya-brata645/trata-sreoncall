// Triage agent — LLM call #1 (§6). Strong model + tools. Its only output
// channel is the raise_alert tool; everything else is investigation.
//
// PLAN NOTE: every judgment (is this abnormal? how severe? which evidence
// supports it?) happens inside the model call below. This file's code only
// wires tools to the query layer/evidence store and shapes the transcript —
// it never itself decides whether to alert or how severe something is.
const crypto = require("crypto");
const evidence = require("../evidence");
const skills = require("../skills/loader");
const llm = require("../llm");
const { INVESTIGATIVE_TOOLS, buildInvestigativeToolImpls } = require("./investigative-tools");

const SYSTEM_PROMPT = `You are the detection and triage layer of an autonomous SRE on-call service. You are not
assisting an engineer — you are covering the shift. Nobody is watching. Nobody asked you to
look. Nobody will tell you what "normal" is: there are no configured thresholds, no alert
rules, no runbooks. Your judgment is the only detection mechanism that exists.

Before you begin, review the skill descriptions available to you and load any that look
relevant to what you are seeing. These are things you have learned working this system
before. They are guidance, not instructions — if the evidence contradicts a skill, trust
the evidence and say so.

How to work:
1. Read the window. Form a hypothesis about what normal looks like for each service from
   the data itself — relative volumes, error proportions, latency shapes.
2. If something looks off, DO NOT alert yet. Use your tools to confirm it. Pull the actual
   log lines. Check whether the metric moved or is just noisy. Look for an error trace —
   traces often show a failure (an error span, an unusually fast or slow call) even when the
   failing service's own logs look clean, because not every failure gets logged. Check
   whether a feature flag changed recently. Check the services that call the one you're
   suspicious of, and the services it calls — the visible symptom and the actual fault are
   often in different services. An alert with one supporting data point is a bad alert. An
   absence of errors in one service's logs is not proof nothing is wrong system-wide.
3. Actively try to disconfirm yourself. Could this be normal for this service? Is the
   sample too small? Is this the tail of something already recovering?
4. Only then call raise_alert.

Rules:
- Every alert MUST carry evidence: the exact query you ran and the literal data it returned
  — log lines with timestamps, metric names and values, trace IDs. Never paraphrase
  evidence. If you cannot quote it, you cannot claim it.
- Severity is your judgment, argued from user impact, not from a number crossing a line.
  A checkout failure and a slow image load are not the same severity at identical error
  rates. Reason about what the service does.
- Raising zero alerts is a valid and often correct outcome. Say so plainly. You are being
  paid to be right, not to look busy. A false page costs a human their night.
- You are read-only on the target system. You must never suggest suppressing, muting,
  filtering, or narrowing telemetry to make a signal go away. That is blinding yourself,
  not fixing anything.

Important: raising an alert means actually calling raise_alert — describing an alert in your
text response without calling the tool has no effect and does not count as having raised it.

When you are done investigating, whether or not you raised any alerts, finish with a short
plain-text summary of what you concluded and why.`;

const RAISE_ALERT_TOOL = {
  name: "raise_alert",
  description:
    "Raise one evidenced alert. Call this once per distinct problem you've confirmed. Every evidence item must reference an evidence_ref you obtained from a prior tool call's result.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      service: { type: "string" },
      severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      severity_reasoning: { type: "string" },
      hypothesis: { type: "string" },
      confidence: { type: "number", description: "Your own informational confidence, 0-1. Never used by code to gate anything." },
      skills_applied: { type: "array", items: { type: "string" } },
      disconfirming_checks: { type: "array", items: { type: "string" } },
      evidence_refs: {
        type: "array",
        items: { type: "string" },
        description: "evidence_ref values returned by your prior tool calls — the literal proof behind this alert.",
      },
    },
    required: ["title", "service", "severity", "severity_reasoning", "hypothesis", "evidence_refs"],
  },
};

const TOOLS = [...INVESTIGATIVE_TOOLS, RAISE_ALERT_TOOL];

function buildToolImpls({ window, onAlertRaised }) {
  return {
    ...buildInvestigativeToolImpls({ services: window.services }),
    raise_alert: async (input) => {
      const alert = {
        id: `alt_${crypto.randomBytes(6).toString("hex")}`,
        title: input.title,
        service: input.service,
        severity: input.severity,
        severity_reasoning: input.severity_reasoning,
        hypothesis: input.hypothesis,
        confidence: input.confidence ?? null,
        skills_applied: input.skills_applied || [],
        disconfirming_checks: input.disconfirming_checks || [],
        evidence: (input.evidence_refs || []).map((ref) => ({ evidence_ref: ref, ...(evidence.get(ref) || {}) })),
        first_seen: new Date().toISOString(),
        last_confirmed: new Date().toISOString(),
        status: "open",
      };
      onAlertRaised(alert);
      return { recorded: true, alert_id: alert.id };
    },
  };
}

// Runs one triage pass over a sensor window. Returns { alerts, summary,
// callLog } — callLog is the full reasoning trace for §9 disclosure level 4.
async function runTriage({ window }) {
  const alerts = [];
  const toolCallLog = [];
  const toolImpls = buildToolImpls({ window, onAlertRaised: (a) => alerts.push(a) });

  const skillDescriptions = skills.listDescriptions();
  const userMessage = [
    `Skill descriptions available to you (call load_skill with a name to get the full body):`,
    JSON.stringify(skillDescriptions, null, 2),
    ``,
    `Current raw sweep window (observed_at: ${window.observed_at}, last ${window.window_minutes} minutes):`,
    `Services seen: ${window.services.join(", ")}`,
    `Log volume by service: ${JSON.stringify(window.volume_by_service)}`,
    `Flag states: ${JSON.stringify(window.flag_states)}`,
    `A raw log sample and recent error traces are available via evidence refs ${window.logs_ref} and ${window.error_traces_ref} — pull more with your tools as needed, these are just a starting point, not the full picture.`,
    ``,
    `Investigate this window. Raise an alert for anything you confirm is a real problem. It is entirely correct to raise zero alerts.`,
  ].join("\n");

  const { finalText, callLog } = await llm.runAgentLoop({
    model: llm.MODEL_STRONG,
    system: SYSTEM_PROMPT,
    userMessage,
    tools: TOOLS,
    toolImpls,
    onToolCall: (entry) => toolCallLog.push({ at: new Date().toISOString(), ...entry }),
  });

  return { alerts, summary: finalText, callLog, toolCallLog };
}

module.exports = { runTriage, SYSTEM_PROMPT, TOOLS };
