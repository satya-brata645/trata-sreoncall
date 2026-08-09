// Progressive-disclosure terminal rendering. Headline first (this module) — full detail
// lives in bin/show.js, on demand.

const SEV_COLOR = {
  SEV1: "\x1b[41m\x1b[97m", // white on red
  SEV2: "\x1b[31m", // red
  SEV3: "\x1b[33m", // yellow
  SEV4: "\x1b[36m", // cyan
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";

function ts() {
  return new Date().toLocaleTimeString();
}

function headline(incident, note) {
  const color = SEV_COLOR[incident.severity] || "";
  console.log(
    `${DIM}[${ts()}]${RESET} ${color}[${incident.severity}]${RESET} ${incident.id} ${incident.service} — ${note || incident.title}`
  );
}

function opened(incident) {
  headline(incident, `NEW — ${incident.title}`);
}

function revised(incident, reason) {
  headline(incident, `REVISED — ${reason}`);
}

function resolved(incident, summary) {
  console.log(`${DIM}[${ts()}]${RESET} ${GREEN}[RESOLVED]${RESET} ${incident.id} ${incident.service} — ${summary}`);
}

function tick(message) {
  console.log(`${DIM}[${ts()}] ${message}${RESET}`);
}

function noIncident(service, reason) {
  console.log(`${DIM}[${ts()}] ${service} — investigated, no incident: ${reason}${RESET}`);
}

module.exports = { opened, revised, resolved, tick, noIncident, headline };
