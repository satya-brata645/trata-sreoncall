// Orchestrator for PLAN-malleability-only-95.md §7. Runs the full
// DECLARE -> RESOLVE -> LEARN -> RE-TRIGGER loop against a controlled
// Kafka-lag scenario, through the UNMODIFIED triage/correlator, and the new
// verified skills/author.js pipeline. Captures every artifact §6 requires.
const fs = require("fs");
const path = require("path");

const mock = require("./mock-lgtm");
mock.install(); // must happen before requiring lgtm.js's consumers

const sensor = require("../src/sensor");
const triage = require("../src/agents/triage");
const correlator = require("../src/agents/correlator");
const skillsAuthor = require("../src/skills/author");
const state = require("../src/state");

const ARTIFACT_DIR = path.join(__dirname, "..", "artifacts", "malleability-demo");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function save(name, data) {
  const filePath = path.join(ARTIFACT_DIR, name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function summarizeRun(label, window, triageResult) {
  return {
    label,
    observed_at: window.observed_at,
    alerts: triageResult.alerts.map((a) => ({
      title: a.title,
      service: a.service,
      severity: a.severity,
      hypothesis: a.hypothesis,
      confidence: a.confidence,
      skills_applied: a.skills_applied,
      disconfirming_checks: a.disconfirming_checks,
      evidence_count: (a.evidence || []).length,
    })),
    tool_call_count: triageResult.toolCallLog.length,
    tool_calls: triageResult.toolCallLog.map((t) => ({ name: t.name, input: t.input })),
    summary: triageResult.summary,
  };
}

function diffRuns(run1, run2) {
  const citesSkill = run2.alerts.some((a) => (a.skills_applied || []).length > 0);
  const toolCallDelta = run1.tool_call_count - run2.tool_call_count;
  const run1Hedge = /may|might|possibl|unclear|unconfirmed|uncertain|not sure/i.test(
    run1.alerts.map((a) => a.hypothesis).join(" ")
  );
  const run2Direct = /producer surge|consumer stall|consumer-side stall/i.test(
    run2.alerts.map((a) => a.hypothesis).join(" ")
  );

  const rows = [
    {
      axis: "Cites the new skill",
      pass1: "n/a — doesn't exist yet",
      pass2: citesSkill ? `YES — ${run2.alerts.flatMap((a) => a.skills_applied).join(", ")}` : "NO",
      cleared: citesSkill,
    },
    {
      axis: "Tool-call count",
      pass1: String(run1.tool_call_count),
      pass2: `${run2.tool_call_count} (delta: ${toolCallDelta >= 0 ? "-" : "+"}${Math.abs(toolCallDelta)})`,
      cleared: run2.tool_call_count < run1.tool_call_count,
    },
    {
      axis: "Hypothesis confidence",
      pass1: run1Hedge ? "hedged language present" : "already direct",
      pass2: run2Direct ? "names the discriminator directly" : "still hedged",
      cleared: run2Direct,
    },
    {
      axis: "Disconfirming checks",
      pass1: `${run1.alerts.flatMap((a) => a.disconfirming_checks || []).length} check(s) (broad)`,
      pass2: `${run2.alerts.flatMap((a) => a.disconfirming_checks || []).length} check(s)`,
      cleared: null, // qualitative — read by hand, not auto-scored
    },
  ];
  return rows;
}

async function main() {
  console.log("=== Step 1: Pass 1 — DECLARE (kafka-lag active, no skill exists yet) ===");
  mock.setStage("active");
  const window1 = await sensor.sweep({ sinceMinutes: 10, logSampleCap: 20 });
  const triageResult1 = await triage.runTriage({ window: window1 });
  console.log(`Pass 1: ${triageResult1.alerts.length} alert(s) raised.`);
  const run1 = summarizeRun("pass1-declare", window1, triageResult1);
  save("run1.json", run1);

  if (!triageResult1.alerts.length) {
    console.error("Pass 1 raised zero alerts — cannot proceed to DECLARE. See run1.json for the investigation transcript.");
    process.exit(1);
  }

  console.log("\n=== Step 2: correlator DECLAREs the incident ===");
  const s = state.emptyState();
  const flagChange = [{ flag: "kafkaQueueProblems", from: "off", to: "on", at: new Date().toISOString() }];
  const declareResult = await correlator.runCorrelator({ state: s, newAlerts: triageResult1.alerts, recentFlagChanges: flagChange });
  console.log(`Correlator actions: ${JSON.stringify(declareResult.actionsTaken)}`);
  const incidentId = Object.keys(s.incidents)[0];
  if (!incidentId) {
    console.error("Correlator did not declare an incident. Summary:", declareResult.summary);
    process.exit(1);
  }
  console.log(`Declared: ${incidentId} (${s.incidents[incidentId].severity})`);

  console.log("\n=== Step 3: kafka-lag recovers, correlator RESOLVEs ===");
  mock.setStage("recovered");
  const resolveResult = await correlator.runCorrelator({ state: s, newAlerts: [], recentFlagChanges: [
    { flag: "kafkaQueueProblems", from: "on", to: "off", at: new Date().toISOString() },
  ] });
  console.log(`Correlator actions: ${JSON.stringify(resolveResult.actionsTaken)}`);
  const incident = s.incidents[incidentId];
  if (incident.status !== "resolved") {
    console.error(`Incident did not resolve (status: ${incident.status}). This is a legitimate outcome to report, not necessarily a bug — the correlator only resolves on real evidence. Summary: ${resolveResult.summary}`);
  } else {
    console.log(`Resolved: ${incidentId}. Revisions: ${incident.revisions.length}`);
  }

  console.log("\n=== Step 4: verified skill-learning pipeline (Harvest -> Judge -> Refute -> Consensus -> Gate -> Author -> Write -> Verify) ===");
  const alertsForIncident = incident.alert_ids.map((id) => s.alerts[id]).filter(Boolean);
  const reflection = await skillsAuthor.reflect({ incident, alerts: alertsForIncident });
  console.log(`Learning outcome: ${reflection.summary}`);
  save("learning-trail.json", reflection.trail);
  console.log(`Actions taken: ${JSON.stringify(reflection.actionsTaken, null, 2)}`);

  const promoted = reflection.actionsTaken.find((a) => a.type === "skill.promoted");

  console.log("\n=== Step 5: Pass 2 — re-trigger the identical scenario ===");
  mock.setStage("active"); // bumps the nonce -> fresh evidence hashes, not a cache hit
  const window2 = await sensor.sweep({ sinceMinutes: 10, logSampleCap: 20 });
  const triageResult2 = await triage.runTriage({ window: window2 });
  console.log(`Pass 2: ${triageResult2.alerts.length} alert(s) raised.`);
  const run2 = summarizeRun("pass2-retrigger", window2, triageResult2);
  save("run2.json", run2);

  console.log("\n=== Step 6: diff pass 1 vs pass 2 ===");
  const rows = diffRuns(run1, run2);
  const mdRows = rows
    .map((r) => `| ${r.axis} | ${r.pass1} | ${r.pass2} | ${r.cleared === null ? "manual review" : r.cleared ? "CLEARED" : "NOT CLEARED"} |`)
    .join("\n");
  const requiredCleared = rows[0].cleared && rows[1].cleared;
  const report = [
    `# Malleability demo — diff report`,
    ``,
    `Skill promoted: ${promoted ? `YES — \`${promoted.name}\`` : "NO"}`,
    promoted ? "" : `Learning pipeline outcome: ${reflection.summary}`,
    ``,
    `| Axis | Pass 1 | Pass 2 | Result |`,
    `|---|---|---|---|`,
    mdRows,
    ``,
    `**Win condition (first two rows must clear): ${requiredCleared ? "MET" : "NOT MET"}.**`,
    requiredCleared
      ? "The second run cites the learned skill and used fewer tool calls — this is real, observed malleability, not asserted."
      : "This run did not clear the stated win condition. Reporting honestly per the plan's own instruction not to spin a failure.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
  fs.writeFileSync(path.join(ARTIFACT_DIR, "diff-report.md"), report);
  console.log("\n" + report);

  mock.uninstall();
  console.log(`\nArtifacts written to ${ARTIFACT_DIR}`);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  mock.uninstall();
  process.exit(1);
});
