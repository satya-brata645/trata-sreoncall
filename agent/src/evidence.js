// Verbatim, content-addressed evidence store.
//
// PLAN NOTE (§6): every claim an agent makes must be traceable to the exact
// query it ran and the exact raw bytes that came back — never a paraphrase.
// This store exists so `evidence_ref` in an alert/incident can always be
// replayed against the literal response, including by a judge asking to see
// the trail behind a specific sentence (§9 disclosure level 4).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORE_DIR = path.join(__dirname, "data", "evidence");
fs.mkdirSync(STORE_DIR, { recursive: true });

function hashOf(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

// Records one piece of evidence and returns its ref (ev_<hash>). `kind` is
// log|metric|trace|flag. `query` is the literal LogQL/PromQL/tag filter
// used. `raw` is the literal, unmodified response — stored as-is, never
// summarized here. Content-addressed: recording the same query+raw twice
// returns the same ref instead of duplicating storage.
function record({ kind, query, raw, observedAt }) {
  const payload = JSON.stringify({ kind, query, raw });
  const ref = `ev_${hashOf(payload)}`;
  const filePath = path.join(STORE_DIR, `${ref}.json`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        { ref, kind, query, raw, observed_at: observedAt || new Date().toISOString() },
        null,
        2
      )
    );
  }
  return ref;
}

function get(ref) {
  const filePath = path.join(STORE_DIR, `${ref}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function exists(ref) {
  return fs.existsSync(path.join(STORE_DIR, `${ref}.json`));
}

module.exports = { record, get, exists };
