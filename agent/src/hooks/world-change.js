// World-change hook (§3). Polls flagd's /list as a literal change feed —
// the closest thing to "a deploy just happened" available in this
// environment. Detecting a flip is plumbing (diffing two snapshots); what
// it MEANS for an incident is the correlator's judgment, not this file's.
const sensor = require("../sensor");

let lastSnapshot = null;

// Returns the list of flag flips since the last call: [{ flag, from, to, at }].
// First call establishes the baseline and returns no changes (nothing to
// diff against yet).
async function pollForChanges() {
  const flags = await sensor.getFlagStates();
  const current = {};
  for (const f of flags) current[f.name] = f.defaultVariant;

  if (!lastSnapshot) {
    lastSnapshot = current;
    return [];
  }

  const changes = [];
  const at = new Date().toISOString();
  for (const [name, value] of Object.entries(current)) {
    if (lastSnapshot[name] !== undefined && lastSnapshot[name] !== value) {
      changes.push({ flag: name, from: lastSnapshot[name], to: value, at });
    }
  }
  lastSnapshot = current;
  return changes;
}

module.exports = { pollForChanges };
