#!/usr/bin/env node
// `node bin/show.js <id>` — full detail on demand (the other half of progressive
// disclosure: headline in watch.js, drill-down here). `node bin/show.js` with no id lists
// every incident's headline.

const store = require("../src/store");

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function printList() {
  const incidents = store.list();
  if (incidents.length === 0) {
    console.log("No incidents recorded yet.");
    return;
  }
  for (const inc of incidents) {
    console.log(`${inc.id}  [${inc.severity}]  ${inc.status.padEnd(13)}  ${inc.service.padEnd(16)}  ${inc.title}`);
  }
  console.log(`\n${DIM}node bin/show.js <id> for full detail${RESET}`);
}

function printDetail(id) {
  const inc = store.get(id);
  if (!inc) {
    console.log(`No such incident: ${id}`);
    process.exit(1);
  }
  console.log(`${BOLD}${inc.id} — ${inc.title}${RESET}`);
  console.log(`Origin service: ${inc.service}  Severity: ${inc.severity}  Status: ${inc.status}  Fix type: ${inc.fixType}`);
  if (inc.affectedServices?.length) console.log(`Blast radius: ${inc.affectedServices.join(", ")}`);
  console.log(`Opened: ${inc.createdAt}${inc.resolvedAt ? `  Resolved: ${inc.resolvedAt}` : ""}`);
  if (inc.prUrl) console.log(`Draft PR: ${inc.prUrl}`);
  console.log(`\n${BOLD}Reasoning timeline (nothing overwritten, each entry is a real revision):${RESET}`);

  for (const entry of inc.timeline) {
    console.log(`\n${DIM}${entry.at}${RESET} — ${BOLD}${entry.type}${RESET}`);
    if (entry.playbookSelections?.length) {
      console.log(`  Investigation approach:`);
      entry.playbookSelections.forEach((sel, i) => {
        const label = i === 0 ? "chose" : "re-selected mid-investigation";
        console.log(`    ${label}: ${(sel.playbookIds || []).join(", ")}`);
        console.log(`      because: ${sel.reasoning}`);
      });
    }
    if (entry.revisionReason) console.log(`  Why revised: ${entry.revisionReason}`);
    if (entry.rootCause) console.log(`  Root cause: ${entry.rootCause}${entry.confidence != null ? ` (confidence ${entry.confidence})` : ""}`);
    if (entry.summary) console.log(`  Summary: ${entry.summary}`);
    const evidence = entry.evidence || entry.resolutionEvidence || [];
    if (evidence.length) {
      console.log(`  Evidence:`);
      for (const e of evidence) {
        console.log(`    [${e.type}] ${e.query}`);
        console.log(`      -> ${e.result}`);
      }
    }
    if (entry.recommendedActions?.length) {
      console.log(`  Recommended actions:`);
      entry.recommendedActions.forEach((a, i) => console.log(`    ${i + 1}. ${a}`));
    }
  }
}

const id = process.argv[2];
if (!id) printList();
else printDetail(id);
