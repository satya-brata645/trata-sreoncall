// World state: open alerts, incidents (with revision history), and the
// self-accountability performance record. Survives across sweeps.
//
// PLAN NOTE: this file only persists what the agents decide — it contains
// no logic that decides severity, correlation, or resolution itself. It is
// the "world state" box in §3's architecture diagram, nothing more.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

function emptyState() {
  return {
    alerts: {}, // alert_id -> alert object
    incidents: {}, // incident_id -> incident object
    recent_windows: [], // bounded log of past sweep summaries, for retroactive review (§8)
    performance: {
      // §8 self-accountability record. Every field here is either a plain
      // count/timestamp or something an agent wrote (e.g. a retroactive-miss
      // note) — never a computed judgment about severity or correctness.
      sweeps_run: 0,
      alerts_raised: 0,
      alerts_that_became_incidents: 0,
      incidents_escalated: 0,
      incidents_resolved: 0,
      retroactive_miss_notes: [], // { at, window_observed_at, agent_finding }
      detect_to_declare_log: [], // { alert_id, incident_id, alert_first_seen, incident_declared_at }
    },
  };
}

function load() {
  if (!fs.existsSync(STATE_FILE)) return emptyState();
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return emptyState();
  }
}

function save(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function openAlerts(state) {
  return Object.values(state.alerts).filter((a) => a.status !== "closed");
}

function openIncidents(state) {
  return Object.values(state.incidents).filter(
    (i) => i.status !== "resolved" && i.status !== "closed"
  );
}

const MAX_RECENT_WINDOWS = 40;

// Records a sweep summary for later retroactive review (§8). Only ever
// stores refs/summaries, never full raw payloads — the evidence store
// already holds the verbatim data behind each ref.
function recordWindow(state, window) {
  state.recent_windows.push({
    observed_at: window.observed_at,
    services: window.services,
    volume_by_service: window.volume_by_service,
    logs_ref: window.logs_ref,
    error_traces_ref: window.error_traces_ref,
    flag_ref: window.flag_ref,
    reviewed_retroactively: false,
    had_alert: false,
  });
  if (state.recent_windows.length > MAX_RECENT_WINDOWS) {
    state.recent_windows.splice(0, state.recent_windows.length - MAX_RECENT_WINDOWS);
  }
}

module.exports = { load, save, emptyState, openAlerts, openIncidents, recordWindow, STATE_FILE };
