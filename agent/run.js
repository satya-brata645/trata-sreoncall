#!/usr/bin/env node
// Entrypoint. Wires the four hooks (§3) to the two agents. This is where
// the system stops being a script someone runs and starts being a service
// that runs itself — nothing here waits for a human to trigger a cycle.
//
// Usage:
//   node run.js            # runs forever, self-paced by the attention hook
//   node run.js --once     # runs exactly one cycle, for testing
const state = require("./src/state");
const attention = require("./src/hooks/attention");
const worldChange = require("./src/hooks/world-change");
const lifecycle = require("./src/hooks/lifecycle");
const human = require("./src/hooks/human");
const triage = require("./src/agents/triage");
const correlator = require("./src/agents/correlator");
const humanResponse = require("./src/agents/human-response");
const skillsAuthor = require("./src/skills/author");
const skills = require("./src/skills/loader");
const selfAccountability = require("./src/self-accountability");
const professionalPractice = require("./src/professional-practice");
const cli = require("./src/surface/cli");

const RETROACTIVE_CHECK_EVERY_N_CYCLES = 5; // operational cadence, not judgment — see PROMPT §0
const PRACTICE_REVIEW_EVERY_N_CYCLES = 3; // schedule only; recovery/recurrence remains model judgment
const RUN_ONCE = process.argv.includes("--once");

// Log every lifecycle event to the console as a plain record of work
// performed — this is the "pushes, doesn't wait to be checked" behavior
// from §0 Test 2, in its simplest form.
lifecycle.on("incident.declared", (e) => console.log(`\n[lifecycle] incident.declared ${e.incident_id}`));
lifecycle.on("incident.revised", (e) => console.log(`\n[lifecycle] incident.revised ${e.incident_id} (${e.action})`));
lifecycle.on("incident.resolved", (e) => console.log(`\n[lifecycle] incident.resolved ${e.incident_id}`));
lifecycle.on("incident.escalated", (e) => console.log(`\n[lifecycle] incident.escalated ${e.incident_id}`));

let cycleCount = 0;

async function runOneCycle() {
  cycleCount += 1;
  const s = state.load();

  console.log(`\n=== cycle ${cycleCount} — ${new Date().toISOString()} ===`);

  // --- attention hook: cheap glance, self-paced cadence ---
  const { worthALook, reasoning, nextCheckInSeconds, window } = await attention.glance();
  s.performance.sweeps_run += 1;
  state.recordWindow(s, window);
  console.log(`[attention] worth_a_look=${worthALook} next_check_in=${nextCheckInSeconds}s — ${reasoning}`);

  // --- world-change hook: flagd diff ---
  const flagChanges = await worldChange.pollForChanges();
  if (flagChanges.length) console.log(`[world-change] ${JSON.stringify(flagChanges)}`);

  const openIncidents = state.openIncidents(s);
  const shouldRunTriage = worthALook;
  const shouldRunCorrelator = worthALook || flagChanges.length > 0 || openIncidents.length > 0;

  let newAlerts = [];
  if (shouldRunTriage) {
    const triageResult = await triage.runTriage({ window });
    newAlerts = triageResult.alerts;
    const applications = professionalPractice.recordSkillApplications({
      state: s,
      alerts: newAlerts,
      loadedSkillNames: triageResult.loadedSkillNames,
    });
    console.log(`[triage] ${newAlerts.length} alert(s) raised. ${triageResult.summary.split("\n")[0]}`);
    if (applications.length) console.log(`[skills] recorded ${applications.length} evidence-backed skill application(s)`);
    if (newAlerts.length) {
      const target = s.recent_windows[s.recent_windows.length - 1];
      if (target) target.had_alert = true;
    }

    // recordSkillApplications (above) is the sole times_applied writer for this
    // path — it requires a skill be BOTH loaded this run AND cited on an alert,
    // which recordApplication alone cannot check, so calling it here too would
    // double-increment the same citation. Its provenance still needs a tracked
    // home (see the note on APPLICATIONS_LOG in loader.js), which is what
    // appendProvenance does without touching the counter a second time.
    for (const entry of applications) {
      skills.appendProvenance({
        skill: entry.skill_name,
        alertId: entry.alert_id,
        run: `cycle-${cycleCount}`,
      });
      console.log(`[skills] applied "${entry.skill_name}" — recorded in applications.jsonl`);
    }
  }

  if (shouldRunCorrelator) {
    const correlatorResult = await correlator.runCorrelator({ state: s, newAlerts, recentFlagChanges: flagChanges });
    console.log(`[correlator] ${correlatorResult.actionsTaken.length} action(s). ${correlatorResult.summary.split("\n")[0]}`);
    for (const action of correlatorResult.actionsTaken) {
      lifecycle.emit(action.type, action);
      // A resolution additionally schedules professionalPractice's own,
      // separate evidence-verified follow-up loop (runNextFollowUp, below) —
      // several LATER independent reviews of whether recovery actually held,
      // not a one-shot reflection. That is a stronger claim than "I noticed a
      // pattern once" and deserves its own trigger point.
      if (action.type === "incident.resolved") {
        const incident = s.incidents[action.incident_id];
        professionalPractice.scheduleResolvedIncident({ state: s, incident });
      }
    }

    // Reflect on anything substantive that happened this cycle — not only on a
    // resolution. This used to fire ONLY inside `if (action.type ===
    // "incident.resolved")`, which is why the loop almost never ran: incidents
    // legitimately stay open across shifts while evidence accumulates, so a
    // shift could investigate hard, learn something real, and record none of
    // it. A resolution is not the only thing worth learning from; a
    // declaration, a revision, or a raised alert all teach something.
    const resolved = correlatorResult.actionsTaken.find((a) => a.type === "incident.resolved");
    const substantive = resolved
      || correlatorResult.actionsTaken.find((a) => a.type === "incident.declared" || a.type === "incident.revised")
      || (newAlerts.length ? { incident_id: null } : null);

    if (substantive) {
      const incident = substantive.incident_id ? s.incidents[substantive.incident_id] : null;
      const alerts = incident
        ? (incident.alert_ids || []).map((id) => s.alerts[id]).filter(Boolean)
        : newAlerts;
      const reflection = await skillsAuthor.reflect({ incident, alerts });
      console.log(`[skills] ${reflection.actionsTaken.map((a) => a.type).join(", ") || "no action"} — ${reflection.summary.split("\n")[0]}`);
    }
  }

  // --- human hook: drain any interjections ---
  for (const msg of human.drain()) {
    const incident = msg.incident_id ? s.incidents[msg.incident_id] : null;
    const { answer } = await humanResponse.respond({ message: msg.text, incident, priorToolCallLog: null });
    console.log(`\n[human] Q: ${msg.text}\n[agent] A: ${answer}`);
  }

  // --- self-accountability: periodic retroactive miss check ---
  if (cycleCount % RETROACTIVE_CHECK_EVERY_N_CYCLES === 0) {
    const note = await selfAccountability.runRetroactiveCheck(s);
    if (note) {
      console.log(
        note.clean
          ? `[self-check] window ${note.window_observed_at} reviewed — no miss found`
          : `[self-check] MISS FOUND for window ${note.window_observed_at}: ${note.agent_finding}`
      );
    }
  }

  // Each resolved incident receives several later independent reviews. This
  // checks whether observed recovery held and turns model-judged recurrence
  // into a provenance-carrying playbook only when fresh evidence supports it.
  if (cycleCount % PRACTICE_REVIEW_EVERY_N_CYCLES === 0) {
    const review = await professionalPractice.runNextFollowUp(s);
    if (review) {
      if (review.skipped) console.log(`[practice] ${review.incident_id}: ${review.reason}`);
      else console.log(`[practice] ${review.incident_id}: recovery=${review.review.recovery_status}, remaining=${review.reviews_remaining}${review.playbook?.written ? `; playbook ${review.playbook.action}: ${review.playbook.name}` : ""}`);
    }
  }

  cli.printHeadlines(s);
  state.save(s);
  return nextCheckInSeconds;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (RUN_ONCE) {
    await runOneCycle();
    return;
  }
  console.log("SREonCall agent starting — unattended, self-paced. Ctrl+C to stop.");
  for (;;) {
    const nextCheckInSeconds = await runOneCycle().catch((err) => {
      console.error("[cycle error]", err.message);
      return 30; // fixed fallback delay on error — infra safety rail, not judgment
    });
    await sleep(nextCheckInSeconds * 1000);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
