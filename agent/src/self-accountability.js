// Self-accountability (§8). Two things: a plain-data performance report
// (no judgment, just counts already recorded by the agents' own actions),
// and the retroactive-miss check — an actual model call that goes back and
// asks whether a window already called clean actually had something in it.
//
// PLAN NOTE: the report below must never be improved by narrowing what the
// agents look at. This file only reads state.performance and recent_windows
// as a mirror — it doesn't decide anything about the target system, and it
// contains no gating logic that could quietly discourage raising alerts to
// keep the numbers clean. If that ever seems tempting while extending this
// file, that's the self-blinding rule (§0/§8) — stop.
const evidence = require("./evidence");
const llm = require("./llm");
const { INVESTIGATIVE_TOOLS, buildInvestigativeToolImpls } = require("./agents/investigative-tools");

// Plain report — every number here is a count the agents already produced
// as a side effect of their own decisions, not a computed judgment.
function performanceReport(state) {
  const p = state.performance;
  const practice = state.practice || { follow_ups: [], playbooks: [] };
  const detectToDeclareMs = p.detect_to_declare_log
    .map((e) => new Date(e.incident_declared_at) - new Date(e.alert_first_seen))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgDetectToDeclareMs = detectToDeclareMs.length
    ? Math.round(detectToDeclareMs.reduce((a, b) => a + b, 0) / detectToDeclareMs.length)
    : null;

  const skillOutcomes = (p.skill_application_log || []).reduce((counts, entry) => {
    const outcome = entry.outcome || "awaiting-resolution";
    counts[outcome] = (counts[outcome] || 0) + 1;
    return counts;
  }, {});

  return {
    sweeps_run: p.sweeps_run,
    alerts_raised: p.alerts_raised,
    alerts_that_became_incidents: p.alerts_that_became_incidents,
    noise_rate: p.alerts_raised > 0 ? 1 - p.alerts_that_became_incidents / p.alerts_raised : 0,
    incidents_resolved: p.incidents_resolved,
    incidents_escalated: p.incidents_escalated,
    avg_detect_to_declare_ms: avgDetectToDeclareMs,
    retroactive_misses_found: p.retroactive_miss_notes.length,
    retroactive_miss_notes: p.retroactive_miss_notes,
    skill_applications: (p.skill_application_log || []).length,
    skill_outcomes: skillOutcomes,
    professional_practice_follow_ups_pending: (practice.follow_ups || []).filter((item) => item.reviews_remaining > 0).length,
    professional_practice_playbooks: (practice.playbooks || []).map((item) => item.skill_name),
  };
}

const SYSTEM_PROMPT = `You are reviewing your own past work as an SRE on-call service, for accountability — not to
look good, to be honest. You are shown a window of telemetry you already judged clean at the
time. Knowing what you know now (later windows, any incidents that followed), re-examine it:
was there something there you should have caught?

If you find a genuine miss, say so plainly and specifically — what was in the window, what
you should have seen, why you didn't. If the window really was clean, say that too; inventing
a miss to seem thorough is exactly as dishonest as hiding a real one.

You may use your tools to check what happened in the minutes after this window, if that helps
you judge whether something was already brewing. Never suggest narrowing what gets collected
or checked in the future — that would be blinding yourself, not fixing anything, and is an
automatic violation of your operating rules regardless of how it's framed.`;

const REPORT_TOOL = {
  name: "report_retroactive_review",
  description: "Report the result of reviewing a past window.",
  input_schema: {
    type: "object",
    properties: {
      found_a_miss: { type: "boolean" },
      finding: { type: "string", description: "What you found, or why the window was genuinely clean." },
    },
    required: ["found_a_miss", "finding"],
  },
};

// Picks the oldest not-yet-reviewed window and asks the model to
// second-guess its own past clean call. Returns null if there's nothing
// eligible yet (needs at least one later window to compare against).
async function runRetroactiveCheck(state) {
  const idx = state.recent_windows.findIndex((w) => !w.reviewed_retroactively);
  if (idx === -1 || idx === state.recent_windows.length - 1) return null; // need a later window to have context

  const target = state.recent_windows[idx];
  const laterWindows = state.recent_windows.slice(idx + 1, idx + 4);

  const userMessage = [
    `Window under review (observed_at: ${target.observed_at}):`,
    `services: ${target.services.join(", ")}`,
    `volume_by_service: ${JSON.stringify(target.volume_by_service)}`,
    `raw logs from that window: ${JSON.stringify(evidence.get(target.logs_ref)?.raw ?? null)}`.slice(0, 4000),
    ``,
    `Windows observed shortly after (for hindsight context):`,
    JSON.stringify(laterWindows.map((w) => ({ observed_at: w.observed_at, volume_by_service: w.volume_by_service, had_alert: w.had_alert }))),
  ].join("\n");

  // Investigate freely with tools first, then structure the verdict — two
  // steps because the tool-use loop and a forced single-tool call don't mix
  // in one request.
  const investigation = await llm.runAgentLoop({
    model: llm.MODEL_STRONG,
    system: SYSTEM_PROMPT,
    userMessage,
    tools: INVESTIGATIVE_TOOLS,
    toolImpls: buildInvestigativeToolImpls(),
    maxTurns: 5,
  });

  const result = await llm.callForStructuredOutput({
    model: llm.MODEL_FAST,
    system: "Summarize the following retroactive-review conclusion into the required structured report. Do not add or remove substance.",
    userMessage: investigation.finalText,
    tool: REPORT_TOOL,
  });

  target.reviewed_retroactively = true;

  if (result.found_a_miss) {
    const note = {
      at: new Date().toISOString(),
      window_observed_at: target.observed_at,
      agent_finding: result.finding,
    };
    state.performance.retroactive_miss_notes.push(note);
    return note;
  }
  return { at: new Date().toISOString(), window_observed_at: target.observed_at, agent_finding: null, clean: true };
}

module.exports = { performanceReport, runRetroactiveCheck };
