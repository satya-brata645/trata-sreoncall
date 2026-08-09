#!/usr/bin/env node
/**
 * Builds `sre-engineer/learning-ledger.md` — one committed file showing
 * everything this SRE has learned, where it came from, and how often it has
 * since been used.
 *
 * Why this exists: the desktop agent's memory lives under `.data/`, which is
 * gitignored, so a reader cloning the repo sees the memory *mechanism* and zero
 * memory *contents*. The learned artifacts themselves are committed, but spread
 * across six capability folders — nobody is going to walk all of them. This
 * collapses the real state onto one page.
 *
 * It reports; it decides nothing. Every fact here is read from an artifact that
 * already exists on disk or from `applications.jsonl` — nothing is inferred,
 * nothing is scored, and an empty section is printed as empty rather than
 * padded. If this file ever starts *ranking* or *filtering* learnings by a
 * number, that is a threshold deciding what matters and it has gone wrong.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPO = path.join(ROOT, "..");
const CAPABILITIES = path.join(ROOT, "capabilities");
const CORRECTIONS = path.join(ROOT, "corrections");
const APPLICATIONS = path.join(REPO, "agent", "src", "data", "applications.jsonl");
const AGENT_SKILLS = path.join(REPO, "agent", "src", "skills");

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

function walk(dir, want) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, want));
    else if (entry.name.endsWith(".md") && want(full, entry.name)) out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(REPO, p);

function collect(kindDir, label) {
  const files = walk(CAPABILITIES, (full) => full.includes(`/${kindDir}/`) && !full.endsWith("FORMAT.md"));
  return files.map((f) => {
    const { meta } = parseFrontmatter(fs.readFileSync(f, "utf8"));
    const capability = (f.match(/capabilities\/([^/]+)\//) || [])[1] || "unknown";
    return {
      label,
      capability,
      name: meta.name || path.basename(f, ".md"),
      description: meta.description || "",
      origin: meta.origin || (kindDir === "baselines" ? "observed" : "unknown"),
      learnedFrom: meta.learned_from || meta.revised_because || "",
      timesApplied: meta.times_applied !== undefined ? Number(meta.times_applied) : null,
      path: rel(f),
    };
  });
}

function agentSkills() {
  const out = [];
  for (const origin of ["learned", "base"]) {
    const dir = path.join(AGENT_SKILLS, origin);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      const { meta } = parseFrontmatter(fs.readFileSync(path.join(dir, name), "utf8"));
      out.push({
        label: "skill",
        capability: "agent (detect/triage)",
        name: meta.name || name.replace(/\.md$/, ""),
        description: meta.description || "",
        origin: meta.origin || origin,
        learnedFrom: meta.learned_from || "",
        timesApplied: meta.times_applied !== undefined ? Number(meta.times_applied) : null,
        path: rel(path.join(dir, name)),
      });
    }
  }
  return out;
}

function corrections() {
  const out = [];
  if (!fs.existsSync(CORRECTIONS)) return out;
  for (const cap of fs.readdirSync(CORRECTIONS)) {
    const dir = path.join(CORRECTIONS, cap);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      const { meta } = parseFrontmatter(fs.readFileSync(path.join(dir, name), "utf8"));
      out.push({
        to: meta.to || cap,
        from: meta.from || "unknown",
        status: meta.status || "open",
        appliedBy: meta.applied_by || "",
        appliedAt: meta.applied_at || "",
        path: rel(path.join(dir, name)),
      });
    }
  }
  return out;
}

function applications() {
  if (!fs.existsSync(APPLICATIONS)) return [];
  return fs.readFileSync(APPLICATIONS, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function table(rows, cols) {
  if (!rows.length) return "_None yet._\n";
  const head = `| ${cols.map((c) => c[0]).join(" | ")} |`;
  const sep = `|${cols.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${cols.map((c) => String(c[1](r) ?? "")).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

const learned = [
  ...collect("playbooks", "playbook"),
  ...collect("experiences", "experience"),
  ...collect("baselines", "baseline"),
  ...agentSkills(),
];
const selfAuthored = learned.filter((l) => /learned|observed|revised/.test(l.origin));
const handWritten = learned.filter((l) => !/learned|observed|revised/.test(l.origin));
const corr = corrections();
const apps = applications();

const out = `# Learning ledger

_Generated by \`sre-engineer/scripts/build-learning-ledger.js\`. Reports what is on disk; it
decides nothing and ranks nothing._

The desktop agent's own memory lives under \`.data/\`, which is gitignored — so this file is
where a reader can actually see what this SRE has accumulated, without walking six capability
folders. Every row points at a real committed file.

## What was learned, not given

Artifacts this SRE wrote itself from real work — as opposed to the hand-written starting
knowledge it shipped with.

${table(selfAuthored, [
  ["Artifact", (r) => `\`${r.name}\``],
  ["Kind", (r) => r.label],
  ["Owner", (r) => r.capability],
  ["Origin", (r) => r.origin],
  ["From", (r) => r.learnedFrom || "—"],
  ["Times applied", (r) => (r.timesApplied === null ? "—" : r.timesApplied)],
  ["File", (r) => `\`${r.path}\``],
])}
## Corrections received

The harder half of the dimension: someone said this agent got something wrong, and it had to
either apply that or argue back. \`applied\` rows carry a note in the file saying what changed.

${table(corr, [
  ["To", (r) => r.to],
  ["From", (r) => r.from],
  ["Status", (r) => `**${r.status}**`],
  ["Applied by", (r) => r.appliedBy || "—"],
  ["When", (r) => r.appliedAt || "—"],
  ["File", (r) => `\`${r.path}\``],
])}
## Application provenance

Every recorded use of a learned artifact, from \`agent/src/data/applications.jsonl\`. A row
here is what makes "this has been used" checkable rather than asserted. The counter is
provenance only — nothing ranks, skips or retires an artifact by it.

${table(apps.slice(-25), [
  ["When", (r) => r.at],
  ["Artifact", (r) => `\`${r.skill}\``],
  ["Origin", (r) => r.origin],
  ["Count after", (r) => r.times_applied],
  ["Incident", (r) => r.incident_id || "—"],
  ["Run", (r) => r.run || "—"],
])}
## Starting knowledge (hand-written, for contrast)

Not learned — the base heuristics this SRE shipped with. Listed so the two are never confused.

${table(handWritten, [
  ["Artifact", (r) => `\`${r.name}\``],
  ["Kind", (r) => r.label],
  ["Owner", (r) => r.capability],
  ["File", (r) => `\`${r.path}\``],
])}`;

fs.writeFileSync(path.join(ROOT, "learning-ledger.md"), out);
console.log(
  `learning-ledger.md written — ${selfAuthored.length} learned, ${handWritten.length} base, ` +
  `${corr.length} correction(s) (${corr.filter((c) => c.status === "applied").length} applied), ` +
  `${apps.length} application row(s)`
);
