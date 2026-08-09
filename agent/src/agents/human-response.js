// Answers a human's question by actually reasoning from the incident's real
// trace and re-investigating with tools if needed — not a canned lookup.
//
// PLAN NOTE: this is what makes §10 test 5 ("ask live why it didn't check
// something first") answerable honestly. It sees the actual prior
// reasoning transcript and can pull more evidence, so it can genuinely
// explain a past decision instead of fabricating a plausible-sounding one.
const llm = require("../llm");
const { INVESTIGATIVE_TOOLS, buildInvestigativeToolImpls } = require("./investigative-tools");

const SYSTEM_PROMPT = `A human is asking you about an incident you are handling (or have handled). Answer from
your actual reasoning and evidence — you are given the real incident record, including its
reasoning and revision history. If they ask why you didn't check something, look at what you
actually did (and, if you have it, the underlying tool-call trace) and answer honestly: either
you did check it and can point to the evidence, or you didn't and should say so plainly rather
than inventing a justification after the fact.

You may use your investigative tools to pull fresh evidence if answering well requires it —
e.g. checking whether something has changed since you last looked. Cite evidence_refs for any
new claims you make. Never suppress, mute, or narrow telemetry to make an answer look better.`;

async function respond({ message, incident, priorToolCallLog }) {
  const toolImpls = buildInvestigativeToolImpls();
  const userMessage = [
    `Human says: "${message}"`,
    ``,
    `Incident record:`,
    JSON.stringify(incident, null, 2),
    ``,
    priorToolCallLog && priorToolCallLog.length
      ? `Your actual tool-call trace from when you worked this incident:\n${JSON.stringify(priorToolCallLog, null, 2)}`
      : `No prior tool-call trace is available for this incident.`,
  ].join("\n");

  const { finalText, callLog } = await llm.runAgentLoop({
    model: llm.MODEL_STRONG,
    system: SYSTEM_PROMPT,
    userMessage,
    tools: INVESTIGATIVE_TOOLS,
    toolImpls,
    maxTurns: 6,
  });

  return { answer: finalText, callLog };
}

module.exports = { respond };
