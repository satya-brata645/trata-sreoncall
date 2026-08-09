#!/usr/bin/env node
/**
 * Records that a capability actually used one of its own learned artifacts.
 *
 * The judgment and the bookkeeping are deliberately split. A capability decides
 * it used a playbook, experience or baseline — that is reasoning, and it names
 * the artifact in its own output. This script only writes down what was already
 * decided: it bumps `times_applied` in that artifact's frontmatter and appends a
 * provenance row. Incrementing a counter concludes nothing about the target
 * system.
 *
 * Nothing may ever gate on the resulting number — no skipping an artifact with a
 * low count, no ranking by it, no retiring one that looks unused. It exists so a
 * reader can check that a lesson was reused, which is a different thing from
 * letting the number decide anything.
 *
 * Usage (from a capability's SKILL.md, via Bash):
 *   node ../../scripts/record-application.js \
 *     --capability log-triage \
 *     --run outputs/20260809_120000 \
 *     --incident inc-001 \
 *     product-catalog triangulate-signals
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPO = path.join(ROOT, "..");
const CAPABILITIES = path.join(ROOT, "capabilities");
const LOG = path.join(ROOT, "applications.jsonl");

const KINDS = ["playbooks", "experiences", "baselines"];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".md") && entry.name !== "FORMAT.md") out.push(full);
  }
  return out;
}

/**
 * An artifact is addressable by its frontmatter `name` or by its filename, so a
 * capability citing "product-catalog" finds baselines/product-catalog.md without
 * having to know the layout.
 */
function findArtifact(nameOrFile) {
  const wanted = nameOrFile.replace(/\.md$/, "");
  for (const file of walk(CAPABILITIES)) {
    if (!KINDS.some((k) => file.includes(`/${k}/`))) continue;
    if (path.basename(file, ".md") === wanted) return file;
    const raw = fs.readFileSync(file, "utf8");
    const m = raw.match(/^---\n[\s\S]*?\nname:\s*(.+?)\n[\s\S]*?\n---/);
    if (m && m[1].trim() === wanted) return file;
  }
  return null;
}

function bump(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^(---\n[\s\S]*?)times_applied:\s*(\d+)([\s\S]*?\n---\n)/);
  if (m) {
    const next = Number(m[2]) + 1;
    fs.writeFileSync(file, raw.replace(m[0], `${m[1]}times_applied: ${next}${m[3]}`));
    return next;
  }
  // Baselines were not authored with the field. Add it rather than silently
  // failing — an artifact that cannot record its own use is a gap, not a
  // reason to drop the record.
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fm) return null;
  fs.writeFileSync(file, `---\n${fm[1]}\ntimes_applied: 1\n---\n${fm[2]}`);
  return 1;
}

const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const capability = opt("--capability");
const run = opt("--run");
const incident = opt("--incident");
const names = args.filter((a, i) => !a.startsWith("--") && !String(args[i - 1] || "").startsWith("--"));

if (!names.length) {
  console.error("record-application: name at least one artifact. Nothing recorded.");
  process.exit(1);
}

const rows = [];
for (const name of names) {
  const file = findArtifact(name);
  if (!file) {
    // Surfaced, not swallowed: a capability citing an artifact that does not
    // exist is worth seeing — it usually means a name drifted or was invented.
    console.error(`record-application: no artifact named "${name}" — not recorded.`);
    rows.push({ artifact: name, recorded: false, reason: "not found" });
    continue;
  }
  const count = bump(file);
  const row = {
    at: new Date().toISOString(),
    artifact: name,
    path: path.relative(REPO, file),
    capability: capability || (file.match(/capabilities\/([^/]+)\//) || [])[1] || null,
    times_applied: count,
    incident_id: incident || null,
    run: run || null,
    recorded: count !== null,
  };
  rows.push(row);
  if (count !== null) fs.appendFileSync(LOG, JSON.stringify(row) + "\n");
  console.log(`recorded: ${name} — times_applied now ${count} (${row.path})`);
}

if (rows.every((r) => !r.recorded)) process.exit(1);
