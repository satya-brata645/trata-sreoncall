// Human hook (§3). A human can interject — ask a question, challenge a
// conclusion, point at something — and it re-enters reasoning rather than
// sitting in a one-way status page. This file is just the inbox: run.js
// drains it each cycle and hands pending messages to
// agents/human-response.js, which is where the actual reasoning happens.
const queue = [];

function ask(text, { incidentId } = {}) {
  queue.push({ text, incident_id: incidentId || null, at: new Date().toISOString() });
}

function drain() {
  const pending = queue.splice(0, queue.length);
  return pending;
}

module.exports = { ask, drain };
