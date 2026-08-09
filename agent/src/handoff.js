// Shift handoff note (§9). The artifact that says "labor was performed,"
// not just "a tool exists" — what a human on-call engineer would write for
// whoever picks up next.
const llm = require("./llm");
const state = require("./state");
const selfAccountability = require("./self-accountability");

const SYSTEM_PROMPT = `Write a shift-handoff note for the next on-call, the way a human would: what happened, what's
still open and why, what you're watching, what you escalated and what you need from a human,
and anything you learned this shift. Be concrete — reference specific incidents and evidence,
not generic status language. If nothing happened, say that plainly; a quiet shift is a fine
report, not something to pad out.`;

async function generate(currentState) {
  const openIncidents = state.openIncidents(currentState);
  const resolved = Object.values(currentState.incidents).filter((i) => i.status === "resolved");
  const escalated = Object.values(currentState.incidents).filter((i) => i.status === "escalated");
  const perf = selfAccountability.performanceReport(currentState);

  const userMessage = [
    `Open incidents:`,
    JSON.stringify(openIncidents, null, 2),
    `Resolved this shift:`,
    JSON.stringify(resolved, null, 2),
    `Escalated this shift:`,
    JSON.stringify(escalated, null, 2),
    `Performance this shift:`,
    JSON.stringify(perf, null, 2),
  ].join("\n");

  const { finalText } = await llm.runAgentLoop({
    model: llm.MODEL_STRONG,
    system: SYSTEM_PROMPT,
    userMessage,
    tools: [],
    toolImpls: {},
    maxTurns: 1,
  });
  return finalText;
}

module.exports = { generate };
