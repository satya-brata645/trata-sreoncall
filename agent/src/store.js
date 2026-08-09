// JSON-file-backed incident store. Every mutation appends a timeline entry — nothing is
// ever overwritten — so the full history of how the agent's read of an incident changed
// over time survives, which is what bin/show.js renders as the malleability trail.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "incidents.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
}

function readAll() {
  ensureFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeAll(incidents) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(incidents, null, 2));
}

function nextId(incidents) {
  const max = incidents.reduce((m, i) => Math.max(m, i.seq || 0), 0);
  return { seq: max + 1, id: `INC-${String(max + 1).padStart(4, "0")}` };
}

function nowIso() {
  return new Date().toISOString();
}

function create({ title, service, affectedServices, severity, rootCause, confidence, evidence, recommendedActions, fixType }) {
  const incidents = readAll();
  const { seq, id } = nextId(incidents);
  const incident = {
    id,
    seq,
    service, // the ORIGIN service — where the fault starts
    affectedServices: affectedServices || [], // blast radius: services degraded as a consequence
    title,
    severity,
    status: "investigating",
    fixType: fixType || "unclear",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    resolvedAt: null,
    prUrl: null,
    timeline: [
      {
        at: nowIso(),
        type: "opened",
        rootCause,
        confidence,
        evidence,
        recommendedActions,
      },
    ],
  };
  incidents.push(incident);
  writeAll(incidents);
  return incident;
}

function get(id) {
  return readAll().find((i) => i.id === id) || null;
}

function list({ openOnly = false } = {}) {
  const incidents = readAll();
  return openOnly ? incidents.filter((i) => i.status !== "resolved") : incidents;
}

function appendTimeline(id, entry) {
  const incidents = readAll();
  const incident = incidents.find((i) => i.id === id);
  if (!incident) throw new Error(`No such incident: ${id}`);
  incident.timeline.push({ at: nowIso(), ...entry });
  incident.updatedAt = nowIso();
  writeAll(incidents);
  return incident;
}

function update(id, { revisionReason, affectedServices, severity, rootCause, confidence, evidence, recommendedActions, fixType }) {
  const incidents = readAll();
  const incident = incidents.find((i) => i.id === id);
  if (!incident) throw new Error(`No such incident: ${id}`);
  if (severity) incident.severity = severity;
  if (fixType) incident.fixType = fixType;
  if (affectedServices) incident.affectedServices = affectedServices;
  incident.timeline.push({
    at: nowIso(),
    type: "revised",
    revisionReason,
    rootCause,
    confidence,
    evidence,
    recommendedActions,
  });
  incident.updatedAt = nowIso();
  writeAll(incidents);
  return incident;
}

function resolve(id, { resolutionEvidence, summary }) {
  const incidents = readAll();
  const incident = incidents.find((i) => i.id === id);
  if (!incident) throw new Error(`No such incident: ${id}`);
  incident.status = "resolved";
  incident.resolvedAt = nowIso();
  incident.timeline.push({
    at: nowIso(),
    type: "resolved",
    summary,
    evidence: resolutionEvidence,
  });
  incident.updatedAt = nowIso();
  writeAll(incidents);
  return incident;
}

// Attaches how-the-investigation-was-conducted metadata (e.g. which playbooks the model
// selected, and any mid-course re-selection) to the most recent timeline entry.
function attachInvestigationMeta(id, meta) {
  const incidents = readAll();
  const incident = incidents.find((i) => i.id === id);
  if (!incident) throw new Error(`No such incident: ${id}`);
  const last = incident.timeline[incident.timeline.length - 1];
  Object.assign(last, meta);
  writeAll(incidents);
  return incident;
}

function setPrUrl(id, prUrl) {
  const incidents = readAll();
  const incident = incidents.find((i) => i.id === id);
  if (!incident) throw new Error(`No such incident: ${id}`);
  incident.prUrl = prUrl;
  writeAll(incidents);
  return incident;
}

module.exports = { create, get, list, appendTimeline, update, resolve, setPrUrl, attachInvestigationMeta };
