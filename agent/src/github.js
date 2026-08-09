// Opens a real draft PR against our own onboarded repo (never merges) for the "Ownership"
// trait — draft-then-approve, mirroring the propose_change/propose_ticket shape in
// reference/sreoncall/packages/api/src/mcp/tools.ts (never writes live, always drafts).
//
// We don't own the OTel Demo app being monitored, so code-level fixes are proposed as real
// commits/PRs on satya-brata645/trata-sreoncall instead — e.g. a runbook, an alert-rule
// config, or a documented fix recommendation file, tied to the specific incident.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let _repoInfo = null;
function repoInfo() {
  if (_repoInfo) return _repoInfo;
  const teamFile = path.join(__dirname, "..", "..", ".hackathon-team.json");
  const { repo } = JSON.parse(fs.readFileSync(teamFile, "utf8"));
  const m = repo.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!m) throw new Error(`Could not parse owner/repo from ${repo}`);
  _repoInfo = { owner: m[1], name: m[2] };
  return _repoInfo;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

let _login = null;
function authenticatedLogin() {
  if (_login) return _login;
  _login = gh(["api", "user", "-q", ".login"]);
  return _login;
}

function hasWriteAccess(owner, name) {
  try {
    const perm = gh(["repo", "view", `${owner}/${name}`, "--json", "viewerPermission", "-q", ".viewerPermission"]);
    return perm === "WRITE" || perm === "ADMIN" || perm === "MAINTAIN";
  } catch {
    return false;
  }
}

function ensureFork(owner, name) {
  try {
    gh(["repo", "fork", `${owner}/${name}`, "--clone=false"]);
  } catch (err) {
    // Already forked is not an error for us.
    if (!/already exists|already have/i.test(err.message)) throw err;
  }
  return authenticatedLogin();
}

// Persistent local clone, reused across proposals so we're not re-cloning on every PR.
function workdir(owner, name) {
  const dir = path.join(__dirname, "..", "data", "pr-workdir", `${owner}-${name}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.join(__dirname, "..", "data", "pr-workdir"), { recursive: true });
    gh(["repo", "clone", `${owner}/${name}`, dir]);
  } else {
    git(["fetch", "origin", "main"], dir);
    git(["checkout", "main"], dir);
    git(["reset", "--hard", "origin/main"], dir);
  }
  return dir;
}

// files: [{ relPath, content }]. Returns the PR URL, or null if `gh` isn't usable (caller
// should fall back to recording the proposed content as evidence instead of failing).
async function proposeFixPr({ incidentId, service, title, body, files }) {
  const { owner, name } = repoInfo();
  const branch = `agent/${incidentId.toLowerCase()}-${service}-${Date.now()}`;
  const writeAccess = hasWriteAccess(owner, name);
  const pushOwner = writeAccess ? owner : ensureFork(owner, name);

  const dir = workdir(owner, name);
  git(["checkout", "-b", branch], dir);

  for (const file of files) {
    const abs = path.join(dir, file.relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.content);
    git(["add", file.relPath], dir);
  }
  git(["-c", "user.email=sreoncall-agent@local", "-c", "user.name=SREonCall Agent", "commit", "-m", title], dir);

  if (writeAccess) {
    git(["push", "-u", "origin", branch], dir);
  } else {
    const forkUrl = `https://github.com/${pushOwner}/${name}.git`;
    try {
      git(["remote", "add", "fork", forkUrl], dir);
    } catch {
      // remote already exists from a prior proposal
    }
    git(["push", "-u", "fork", branch], dir);
  }

  const bodyFile = path.join(os.tmpdir(), `pr-body-${Date.now()}.md`);
  fs.writeFileSync(bodyFile, body);
  const prArgs = [
    "pr",
    "create",
    "--repo",
    `${owner}/${name}`,
    "--base",
    "main",
    "--draft",
    "--title",
    title,
    "--body-file",
    bodyFile,
  ];
  if (!writeAccess) prArgs.push("--head", `${pushOwner}:${branch}`);
  else prArgs.push("--head", branch);

  const url = gh(prArgs);
  fs.unlinkSync(bodyFile);
  git(["checkout", "main"], dir);
  return url;
}

module.exports = { proposeFixPr, hasWriteAccess, repoInfo };
