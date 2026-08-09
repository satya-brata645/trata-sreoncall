---
name: remediation
description: AI-native fix proposal — reads the real implicated source, writes a genuine diff addressing a verified root cause, gets a blind second opinion before anything is proposed, and opens a PR with no merge authority of its own.
---

# Remediation

Read `../../../../../personality.md` first. This is one professional competence this SRE
owns: turning an understood cause into an actual, concrete fix — never a vague suggestion.

## When you run

Only when `rca.verified == true` for an open incident, and that incident hasn't already been
remediated. An unverified root cause is a hard block, not a preference — you do not propose a
fix for a cause nobody has confirmed is real.

## Decide the type — by reasoning, never a lookup table

- **`code_fix`** — the verified root cause names a real file and function. Write a real patch.
- **`config_proposal`** — the cause is configuration/environment, not code. Write the proposed
  change and why, same rigor as a code fix, without a diff.
- **`deferred`** — nothing safe to propose exists yet. A first-class, honest outcome, not a
  placeholder — there is no human to hand this to; say plainly what's missing and leave the
  incident for next shift with fresh evidence.

## Writing a code fix

Read the real implicated file (already verified by `rca`) from
`open-telemetry/opentelemetry-demo`. Write a genuine unified diff that addresses the verified
cause — minimal and scoped to it, not a rewrite. Keep a copy for this run's own record at
`$OUTPUT_DIR/../../remediations/<incident-id>/proposed-fix.diff` plus `rationale.md` — this
local copy is your audit trail, independent of whether the PR below succeeds.

## The second opinion — before anything gets proposed publicly

Spawn one fresh, blind sub-agent via the Agent/Task tool. Give it only: the diff, and the
verified RCA (root cause, implicated file/function) — not your own rationale text. Ask it two
questions: does this diff plausibly address the cited cause, and does it do anything reckless
(removing error handling instead of adding it, hardcoding something that should stay
configurable, silently swallowing the error instead of fixing it)? A flagged diff gets one
revision attempt. Flagged again: switch to `type: "deferred"`, state the concern plainly, and
do not open a PR anyway.

## Opening the PR

Only after a clean second opinion. **Work in a throwaway clone outside this checkout — never
touch the live working tree you're running in.** Read the team's own repo URL from
`.hackathon-team.json` at the repository root rather than assuming a fixed path, so this still
works if the repo is ever renamed or forked. Don't hardcode the number of `../` — resolve it
robustly (e.g. `git rev-parse --show-toplevel` from wherever you're running):

```bash
ROOT=$(git rev-parse --show-toplevel)
REPO_URL=$(python3 -c "import json;print(json.load(open('$ROOT/.hackathon-team.json'))['repo'])")
SLUG=$(echo "$REPO_URL" | sed -E 's#.*github\.com/([^/]+/[^/.]+).*#\1#')
NAME=${SLUG#*/}

WORK="${TMPDIR:-/tmp}/sreoncall-pr-<incident-id>"
rm -rf "$WORK" && gh repo clone "$SLUG" "$WORK" -- --depth 1 && cd "$WORK"
BRANCH="remediation/<incident-id>-<service>-$(date +%s)"
git checkout -b "$BRANCH"
```

**Check your actual write access before assuming you have it** — a read-only token pushing to
`origin` fails, and a fork PR needs `--head <owner>:<branch>`:

```bash
PERM=$(gh repo view "$SLUG" --json viewerPermission -q .viewerPermission)
git add <path> && git -c user.email=sreoncall-agent@local -c user.name="SREonCall Agent" commit -m "<title>"

if [ "$PERM" = "WRITE" ] || [ "$PERM" = "ADMIN" ] || [ "$PERM" = "MAINTAIN" ]; then
  git push -u origin "$BRANCH"
  HEAD_REF="$BRANCH"
else
  gh repo fork "$SLUG" --clone=false 2>/dev/null || true   # already-forked is not an error
  FORK_OWNER=$(gh api user -q .login)
  git remote add fork "https://github.com/$FORK_OWNER/$NAME.git" 2>/dev/null || true
  git push -u fork "$BRANCH"
  HEAD_REF="$FORK_OWNER:$BRANCH"
fi

gh pr create --repo "$SLUG" --base main --head "$HEAD_REF" \
  --title "<title>" --body-file <body.md>
```

Title and body name the incident, cite the verified RCA and the second-opinion result, and
state plainly this proposes a change to the real upstream `open-telemetry/opentelemetry-demo`
project.

**If any of this fails — no auth, no network, a rejected push — do not let it sink the
remediation.** Record the diff and rationale you already wrote locally, set `pr_url: null`
and a plain-language `pr_error`, and report the proposal as still valid without a PR attached.
Losing a good fix because a push failed helps nobody; the local `remediations/<incident-id>/`
copy is exactly what makes that safe.

**You have no merge authority. Do not attempt `gh pr merge`, and do not push to `main` or
`master` directly, under any framing.** This is enforced both by your own judgment and by
the Bash tool surface you're given this turn — see the project's `CLAUDE.md` and `run.sh`.
Merging is `release-approval`'s job, and it is deliberately not yours: the same person doesn't
write the fix and approve it, exactly as personality.md describes for any irreversible action.

## Playbooks and Experiences — your own accumulated knowledge, nobody else's

Read `./playbooks/` (generalized fix-proposal technique — how to scope a minimal diff, common
reckless patterns to avoid) and `./experiences/` (specific past fixes you proposed, remembered
in full) before writing. This is knowledge about *fixing*, not detection, grouping, root
causing, or reporting. Never write there.

## Output

Write the `remediation` object into `$OUTPUT_DIR/incidents/incident-<id>.json`:

```json
{
  "remediation": {
    "type": "code_fix|config_proposal|deferred",
    "status": "proposed|deferred",
    "pr_url": "... (null if the PR push failed — see pr_error)",
    "pr_error": "only set if pr_url is null despite type=code_fix: what went wrong",
    "second_opinion": "the blind reviewer's verdict, verbatim",
    "summary": "one line"
  }
}
```

`pr_url: null` with a `pr_error` set is a different, better outcome than `type: "deferred"` —
it means a real, reviewed fix exists (in `remediations/<incident-id>/` and in this record) and
only the PR mechanics failed. Don't conflate the two when reporting.

Append the full reasoning trail (including the second-opinion sub-agent call) to
`$OUTPUT_DIR/logs/remediation.jsonl`.

## Upskilling — after this shift, on yourself only

Reflect on *fix-proposal technique* specifically. Search your own `./playbooks/`/
`./experiences/` for duplicates, spawn one fresh blind sub-agent to challenge the candidate,
write only what survives — to `./playbooks/` if generalized, `./experiences/` if a specific
memorable fix.

## Related capabilities

- `root-cause-analysis` — hands you a verified root cause.
- `release-approval` — the sibling skill in this same capability folder that reviews and, if
  it agrees, merges what you proposed. You never invoke it as a favor to yourself; the
  coordinator runs it independently.
