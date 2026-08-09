#!/usr/bin/env node
// `node bin/ask.js "<question>" [incidentId]` — ad-hoc live Q&A, not cached. Exists
// specifically to survive the anti-gaming checks in docs/03-judging-and-gaps.md: a judge's
// follow-up the demo run didn't cover gets answered from fresh queries, not a canned reply,
// and re-asking the same question won't produce byte-identical evidence if reality changed.

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const store = require("../src/store");
const { runToolLoop } = require("../src/openaiClient");
const { READ_TOOLS, dispatch } = require("../src/tools");

async function main() {
  const question = process.argv[2];
  const incidentId = process.argv[3];
  if (!question) {
    console.error('Usage: node bin/ask.js "<question>" [incidentId]');
    process.exit(1);
  }

  const incident = incidentId ? store.get(incidentId) : null;
  const incidentContext = incident
    ? `The question is about ${incident.id} (${incident.service}, status ${incident.status}). Its full timeline: ${JSON.stringify(incident.timeline)}`
    : "No specific incident was referenced — answer using live queries only.";

  const system = `You are the SRE agent answering a live follow-up question. You have read-only tools
against real Mimir/Loki/Tempo data (query_metric, query_logs, search_error_traces, get_trace_spans,
list_related_services) — use them to ground your answer in fresh evidence, don't rely on memory or
guesswork. Cite the literal query/value you used. ${incidentContext}`;

  const result = await runToolLoop({
    system,
    userMessage: question,
    tools: READ_TOOLS,
    dispatch,
    terminalToolNames: [],
    maxTurns: 6,
  });

  console.log(result.content);
  if (result.toolCallLog.length) {
    console.log("\n--- live queries used to answer this ---");
    for (const c of result.toolCallLog) {
      console.log(`[${c.name}] ${JSON.stringify(c.args)}`);
    }
  }
}

main().catch((err) => {
  console.error("ask failed:", err.message);
  process.exit(1);
});
