// Skills loader — reads every skill's frontmatter (name + one-line
// description) so the model can choose what to load in full.
//
// PLAN NOTE (§5, rule 2): "the model selects, not a router." This file must
// never contain anything resembling `if (service === 'kafka') load(...)`.
// Its only job is: list what exists (descriptions only), and hand back full
// bodies for whatever names the model asks for. The choice of which skills
// are relevant is made by the triage agent via the load_skill tool.
const fs = require("fs");
const path = require("path");

const BASE_DIR = path.join(__dirname, "base");
const LEARNED_DIR = path.join(__dirname, "learned");
const PROFESSIONAL_PRACTICES_DIR = path.join(__dirname, "professional-practices");

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const [, frontmatter, body] = match;
  const meta = {};
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    meta[key] = value;
  }
  return { meta, body: body.trim() };
}

function readSkillFile(dir, filename) {
  const raw = fs.readFileSync(path.join(dir, filename), "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return {
    name: meta.name || filename.replace(/\.md$/, ""),
    description: meta.description || "",
    origin: meta.origin || (dir === LEARNED_DIR ? "learned" : "base"),
    learned_from: meta.learned_from || null,
    evidence_refs: Array.isArray(meta.evidence_refs) ? meta.evidence_refs : [],
    confidence: meta.confidence !== undefined ? Number(meta.confidence) : null,
    times_applied: meta.times_applied !== undefined ? Number(meta.times_applied) : 0,
    times_verified: meta.times_verified !== undefined ? Number(meta.times_verified) : 0,
    kind: meta.kind || "skill",
    last_reviewed_at: meta.last_reviewed_at || null,
    body,
    _dir: dir,
    _filename: filename,
  };
}

function collectMarkdownFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push({ dir, filename: entry.name });
  }
  return files;
}

function listAllSkillFiles() {
  const dirs = [BASE_DIR, PROFESSIONAL_PRACTICES_DIR, LEARNED_DIR];
  const files = [];
  for (const dir of dirs) {
    collectMarkdownFiles(dir, files);
  }
  return files;
}

// Everything the model sees when deciding what to load: name + description
// only. This is progressive disclosure applied to the agent's own
// knowledge (§5, rule 2) — full heuristic bodies stay hidden until asked for.
function listDescriptions() {
  return listAllSkillFiles().map(({ dir, filename }) => {
    const skill = readSkillFile(dir, filename);
    return {
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      times_applied: skill.times_applied,
    };
  });
}

// Loads one skill's full body by name, for the load_skill tool.
function loadByName(name) {
  for (const { dir, filename } of listAllSkillFiles()) {
    const skill = readSkillFile(dir, filename);
    if (skill.name === name) return skill;
  }
  return null;
}

// ---------------------------------------------------------------- receipts --
//
// `times_applied` used to be decorative: author.js wrote the literal 0, this
// file read it back, and six SKILL.md files instructed the model to increment
// it — but nothing ever did, so it read 0 forever and there was no way to show
// that a learned skill had ever actually been used. This is that writer.
//
// The split matters and is deliberate: the MODEL decides it used a skill (and
// names it in the alert's `skills_applied`/`playbooks_applied` field, which is
// a judgment); this code only records what was already decided. Incrementing a
// counter concludes nothing about the target system.
//
// Nothing may ever gate on the resulting value — no "skip skills with
// times_applied < N", no ranking by it. It is provenance a reader can check,
// not an input to any decision. That would be exactly the smuggled threshold
// this project bans everywhere else.

// Deliberately NOT under src/data/, which is gitignored. This log is the whole
// point of the counter — it is what makes "this learned skill has been used"
// checkable by someone reading the repo rather than a claim they have to take
// on trust. A provenance record nobody can see is not provenance.
const APPLICATIONS_LOG = path.join(__dirname, "..", "..", "applications.jsonl");

function bumpTimesApplied(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^(---\n[\s\S]*?)times_applied:\s*(\d+)([\s\S]*?\n---\n)/);
  if (!match) return null;
  const next = Number(match[2]) + 1;
  fs.writeFileSync(
    filePath,
    raw.replace(match[0], `${match[1]}times_applied: ${next}${match[3]}`)
  );
  return next;
}

// Appends a provenance row WITHOUT touching times_applied. For callers that
// already incremented the counter themselves (professionalPractice's
// recordSkillApplications, which requires a skill be both loaded this run and
// cited — a stronger check than this file can make on its own) but whose
// record of *that* still lands only in state.json, under the gitignored
// src/data/. A counter nobody can inspect is not provenance; this is the fix.
function appendProvenance({ skill, incidentId, alertId, run }) {
  const found = loadByName(skill);
  const row = {
    at: new Date().toISOString(),
    skill,
    origin: found ? found.origin : null,
    times_applied: found ? found.times_applied : null,
    incident_id: incidentId || null,
    alert_id: alertId || null,
    run: run || null,
  };
  fs.mkdirSync(path.dirname(APPLICATIONS_LOG), { recursive: true });
  fs.appendFileSync(APPLICATIONS_LOG, JSON.stringify(row) + "\n");
  return row;
}

// Records that the named skills were actually used on this run. Returns one
// row per skill so a caller can log or surface it. Unknown names are reported
// rather than silently dropped — a model citing a skill that doesn't exist is
// worth seeing, not hiding.
//
// Not used for skills already recorded via professionalPractice.
// recordSkillApplications (see appendProvenance above) — this is for callers
// that both decide AND increment in one step, e.g. sre-engineer's equivalent
// script on the Claude-Code side.
function recordApplication(names, context = {}) {
  const rows = [];
  for (const name of names || []) {
    const skill = loadByName(name);
    if (!skill) {
      rows.push({ name, recorded: false, reason: "no such skill" });
      continue;
    }
    const filePath = path.join(skill._dir, skill._filename);
    const count = bumpTimesApplied(filePath);
    const row = {
      at: new Date().toISOString(),
      skill: name,
      origin: skill.origin,
      times_applied: count,
      incident_id: context.incidentId || null,
      alert_id: context.alertId || null,
      run: context.run || null,
      recorded: count !== null,
    };
    rows.push(row);
    if (count !== null) {
      fs.mkdirSync(path.dirname(APPLICATIONS_LOG), { recursive: true });
      fs.appendFileSync(APPLICATIONS_LOG, JSON.stringify(row) + "\n");
    }
  }
  return rows;
}

module.exports = {
  listDescriptions,
  loadByName,
  parseFrontmatter,
  listAllSkillFiles,
  readSkillFile,
  recordApplication,
  appendProvenance,
  BASE_DIR,
  LEARNED_DIR,
  APPLICATIONS_LOG,
  PROFESSIONAL_PRACTICES_DIR,
};
