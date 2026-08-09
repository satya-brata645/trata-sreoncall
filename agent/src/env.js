// Tiny .env loader — no dependency. Reads the repo-root .env (one level up
// from this package) so the agent shares the same credentials/endpoints the
// rest of the hackathon stack uses.
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, "..", "..", ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

module.exports = {
  MIMIR_URL: process.env.MANAGED_MIMIR_URL || "http://10.10.1.139:9009",
  LOKI_URL: process.env.MANAGED_LOKI_URL || "http://10.10.1.139:3100",
  TEMPO_URL: process.env.MANAGED_TEMPO_URL || "http://10.10.1.139:3200",
  ORG_ID: process.env.MANAGED_LGTM_ORG_ID || "hackathon",
  // NOT process.env.TARGET_APP_FLAGD_UI — that's the :4000 web UI, which
  // docs/04 confirms fires zero write requests and isn't reliable for reads
  // either. :4001 is the real toggle/list API.
  FLAGD_URL: process.env.MANAGED_FLAGD_API_URL || "http://10.10.1.141:4001",
  // docs/02-connecting-to-lgtm.md names OPENAI_API_KEY explicitly as "your
  // team's AI key" — used here for reasoning, unrelated to the LGTM
  // connection above. (ANTHROPIC_API_KEY in .env is a Claude Code OAuth
  // session token, not a direct Messages-API key, so it can't be used here.)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  // Strong tier: real triage/correlation reasoning. Fast tier: cheap "worth a
  // closer look?" attention-hook glances. Override via env if your key has
  // different model access.
  OPENAI_MODEL_STRONG: process.env.OPENAI_MODEL_STRONG || "gpt-4o",
  OPENAI_MODEL_FAST: process.env.OPENAI_MODEL_FAST || "gpt-4o-mini",
};
