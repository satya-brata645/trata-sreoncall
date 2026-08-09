#!/usr/bin/env node
// Main long-running agent process: `node bin/watch.js`
// Every tick: cheap LLM triage across all services -> for anything flagged (new or
// already-open), run the deep investigation loop -> print a progressive-disclosure
// headline the moment anything opens/revises/resolves. No human trigger anywhere in this
// loop — this is the Agency trait.

const fs = require("fs");
const path = require("path");

// Load repo-root .env without adding a dotenv dependency.
const envPath = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const store = require("../src/store");
const dashboard = require("../src/dashboard");
const { runTriageTick } = require("../src/triage");
const { investigate } = require("../src/investigate");

const POLL_INTERVAL_MS = Number(process.env.AGENT_POLL_INTERVAL_MS || 25000);

async function tick() {
  const openIncidents = store.list({ openOnly: true });
  const openServices = openIncidents.map((i) => i.service);

  let flags;
  try {
    flags = await runTriageTick(openServices);
  } catch (err) {
    dashboard.tick(`triage tick failed: ${err.message}`);
    return;
  }

  if (flags.length === 0) {
    dashboard.tick(`triage: nothing worth investigating this tick (${openIncidents.length} open incident(s))`);
    return;
  }

  for (const flag of flags) {
    dashboard.tick(`investigating ${flag.service}: ${flag.reason}`);
    try {
      const result = await investigate({
        service: flag.service,
        triageReason: flag.reason,
        triageConfidence: flag.confidence,
        // Re-read each iteration: an incident opened earlier in this same tick must be
        // visible to the next investigation, or they duplicate each other.
        openIncidents: store.list({ openOnly: true }),
      });

      if (!result.terminal) {
        dashboard.tick(`${flag.service}: investigation ended without a terminal decision (${result.content || "no output"})`);
        continue;
      }

      const { name, args, result: toolResult } = result.terminal;
      if (name === "open_incident") {
        dashboard.opened(toolResult);
      } else if (name === "update_incident") {
        dashboard.revised(toolResult, args.revisionReason);
      } else if (name === "resolve_incident") {
        dashboard.resolved(toolResult, args.summary);
      } else if (name === "no_incident") {
        dashboard.noIncident(flag.service, args.reason);
      }

      const prCall = result.toolCallLog.find((c) => c.name === "propose_fix_pr");
      if (prCall?.result?.prUrl) {
        dashboard.tick(`draft PR opened for ${flag.service}: ${prCall.result.prUrl}`);
      } else if (prCall?.result?.error) {
        dashboard.tick(`PR proposal recorded (not opened live): ${prCall.result.error}`);
      }
    } catch (err) {
      dashboard.tick(`investigation of ${flag.service} failed: ${err.message}`);
    }
  }
}

async function main() {
  console.log("SREonCall agent watching live traffic. No human trigger required. Ctrl+C to stop.");
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms. Incident detail: node bin/show.js <id>. Ask: node bin/ask.js "<question>"`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
