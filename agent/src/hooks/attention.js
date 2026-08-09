// Attention hook (§3). A cheap/fast model glance decides "worth a closer
// look?" AND how long until the next check — self-paced monitoring, not a
// fixed cron interval.
//
// PLAN NOTE: `next_check_in_seconds` comes from the model on every call —
// never a constant. The MIN/MAX clamp below is a scheduler safety rail
// (never spin, never go silent forever), not a judgment about the target
// system, so it doesn't violate §0.
const sensor = require("../sensor");
const llm = require("../llm");

const MIN_CHECK_SECONDS = 5;
const MAX_CHECK_SECONDS = 30 * 60;

const SYSTEM_PROMPT = `You are the attention layer of an autonomous SRE on-call service — a cheap, fast glance at
the system, not the real investigation. Your only job: is anything here worth waking the
full triage agent for, and how urgently should we look again?

Do not conclude anything about root cause or severity — that's triage's job, not yours.
Just judge: does this window look different from what you'd expect quiet/normal to look
like? If genuinely uncertain, say worth_a_look=true — a wasted triage pass costs far less
than a missed incident.

Pick next_check_in_seconds like an on-call engineer would: short (5-30s) when something
looks tense or you just escalated, much longer (10-30 minutes) when everything looks flat
and quiet. This is your judgment call every time, not a fixed number.`;

const REPORT_TOOL = {
  name: "report_attention",
  description: "Report your attention-layer judgment for this window.",
  input_schema: {
    type: "object",
    properties: {
      worth_a_look: { type: "boolean" },
      reasoning: { type: "string" },
      next_check_in_seconds: {
        type: "number",
        description: "Seconds until the next glance. Short when tense, long when quiet.",
      },
    },
    required: ["worth_a_look", "reasoning", "next_check_in_seconds"],
  },
};

function clamp(seconds) {
  return Math.min(MAX_CHECK_SECONDS, Math.max(MIN_CHECK_SECONDS, Math.round(seconds)));
}

// One glance. Returns { worthALook, reasoning, nextCheckInSeconds, window }
// so the caller can hand `window` straight to triage if worthALook is true,
// without re-fetching.
async function glance() {
  const window = await sensor.sweep({ sinceMinutes: 3, logSampleCap: 15 });

  const userMessage = [
    `observed_at: ${window.observed_at}`,
    `services: ${window.services.join(", ")}`,
    `log volume by service (last 3m): ${JSON.stringify(window.volume_by_service)}`,
    `flag states: ${JSON.stringify((window.flag_states || []).map((f) => `${f.name}=${f.defaultVariant}`))}`,
    `error-trace sample present: ${window.raw_error_traces?.traces?.length ?? 0} traces`,
  ].join("\n");

  const result = await llm.callForStructuredOutput({
    model: llm.MODEL_FAST,
    system: SYSTEM_PROMPT,
    userMessage,
    tool: REPORT_TOOL,
  });

  return {
    worthALook: result.worth_a_look,
    reasoning: result.reasoning,
    nextCheckInSeconds: clamp(result.next_check_in_seconds),
    window,
  };
}

module.exports = { glance, MIN_CHECK_SECONDS, MAX_CHECK_SECONDS };
