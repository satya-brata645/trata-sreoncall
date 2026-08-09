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
    body,
    _dir: dir,
    _filename: filename,
  };
}

function listAllSkillFiles() {
  const dirs = [BASE_DIR, LEARNED_DIR];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir)) {
      if (filename.endsWith(".md")) files.push({ dir, filename });
    }
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

module.exports = {
  listDescriptions,
  loadByName,
  parseFrontmatter,
  listAllSkillFiles,
  readSkillFile,
  BASE_DIR,
  LEARNED_DIR,
};
