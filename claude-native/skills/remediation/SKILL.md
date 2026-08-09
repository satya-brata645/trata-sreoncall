---
name: remediation
description: AI-native remediation — turns an established root cause into ordered, incident-specific next steps and, when the fix is a concrete reviewable change, opens a real draft PR on this team's own repo. Proposes actions on the target system; never performs them.
---

# Remediation

You take an incident that has a root cause and produce the thing a human actually needs: what
to do, in what order, with the specific value or path involved, and how they will know it
worked. Where the fix is a concrete change someone could review, you open a real draft PR
rather than describing one.

Delete every reasoning step here and nothing should come out — no steps, no fix, no PR. The
steps must be derived from *this* incident's cause each time.

**The one thing this skill forbids absolutely**: a runbook that would read the same for any
other incident. "Check the logs, scale the service, escalate if unresolved" is what a template
produces, and a template is exactly what a human already has. If your output would still make
sense after find-and-replacing the service name, you have written nothing.

**The second thing, equally absolute**: you are read-only on the target system. You never
call `/toggle`, never restart, scale, redeploy or reconfigure anything at `10.10.1.141`. You
*propose* those actions. This is shared infrastructure that other teams are running against,
and an agent that quietly acts on it is not owning the incident, it is causing the next one.

## Inputs

Read, in this order:
1. `$OUTPUT_DIR/incidents/incident-<NNN>.json` — any incident with an `rca_ref` and no
   `remediation_ref` yet, or whose RCA has materially changed since remediation was written.
2. The RCA at `$OUTPUT_DIR/rca/rca-<NNN>.md` — its `Origin` and `Fix type` are your starting
   point. Do not re-run the investigation; if the RCA says the cause is unknown, your job is
   to say what would establish it, not to guess a fix.
3. `$OUTPUT_DIR/alerts/*.json` for this incident — the evidence and, importantly, the exact
   queries. Your verification step should re-run a query already cited, so before and after
   are directly comparable.
4. `../self-skilling/learned/` — read the descriptions, load what looks relevant.

## How to work

1. **Order the steps the way a human on-call actually works**: stop the bleeding, then
   confirm the bleeding stopped, then the durable fix, then what prevents a recurrence. A
   list of true statements in arbitrary order is not a plan.
2. **Every step names something specific** — the flag, the setting and its current versus
   intended value, the file path, the query to run. A step a reader still has to research is
   not a step.
3. **Give each step a verification**, and prefer a query already cited in this incident's
   evidence. "Recovered" has to mean the same measurement reading differently, not a general
   feeling that things look better.
4. **Decide whether there is a real change to propose.** If you can name a specific,
   reviewable artifact — a runbook capturing this exact remediation, a config value, a code
   path — open the draft PR (§ Opening the PR). If you genuinely cannot, write the steps and
   say plainly why no PR: an honest "the fix is an operator action with nothing to commit" is
   a fine outcome, an invented file to look productive is not.
5. **Note what you are deliberately not doing**, and why. The restart that would clear the
   symptom and destroy the evidence. The rollback that is not yours to call. This section is
   what separates a proposal from a reflex.

## Opening the PR

We do not own the OpenTelemetry Demo app, so a fix lands as a real, reviewable artifact in
**this team's own repo** — read the URL from `../.hackathon-team.json` (relative to the
`alert-grouping/` project directory). Always a draft. Never merged.

Work in a throwaway clone outside this checkout so the live working tree is never touched:

```bash
REPO_URL=$(python3 -c "import json;print(json.load(open('../.hackathon-team.json'))['repo'])")
SLUG=$(echo "$REPO_URL" | sed -E 's#.*github\.com/([^/]+/[^/.]+).*#\1#')
NAME=${SLUG#*/}
PERM=$(gh repo view "$SLUG" --json viewerPermission -q .viewerPermission)

WORK="${TMPDIR:-/tmp}/sreoncall-pr-inc-NNN"
rm -rf "$WORK" && gh repo clone "$SLUG" "$WORK" -- --depth 1 && cd "$WORK"
git checkout -b "agent/inc-NNN-<service>-$(date +%s)"
```

Write the artifact, commit it with an identity that makes its author obvious:

```bash
git add <path>
git -c user.email=sreoncall-agent@local -c user.name="SREonCall Agent" commit -m "<title>"
```

Push — direct if the token can, through a fork if it cannot. **Check, do not assume**: a
read-only token pushing to `origin` fails, and a fork PR needs `--head <owner>:<branch>`:

```bash
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

gh pr create --repo "$SLUG" --base main --draft \
  --head "$HEAD_REF" --title "<title>" --body-file <body.md>
```

If any of this fails — no `gh` auth, no network, a rejected push — **do not let it sink the
remediation**. Record the full artifact content you would have committed inside the
remediation JSON's `proposed_artifact` field and set `"pr_url": null` with `pr_error`. The
recommendation survives without the PR; losing it because a push failed helps nobody.

### What goes in the PR

The body cites this incident's actual numbers, trace IDs and error text — never a generic
description of the fault class. A reviewer should be able to re-run one query from the body
and see the same thing you saw. Typical artifact paths:

- `runbooks/<service>-<symptom>.md` — the remediation for this exact fault: the specific
  setting or flag, its current and intended value, the literal query that verifies recovery,
  and what to check first if it recurs.
- A concrete config or code change at its real path, where the cause is genuinely ours to fix.

## Rules

- No thresholds decide anything here — not whether to open a PR, not how urgent a step is.
  "Open a PR when there is a specific reviewable change to propose" is a judgment you make
  each time, not a confidence figure crossing a line.
- Never propose reducing what the system can see: muting an alert, dropping a log stream,
  narrowing a query to exclude the noisy data, lowering a sampling rate to make a graph
  calmer. That is blinding yourself, and it is an automatic violation whatever the framing.
- Never propose destroying evidence before it has been captured. If a restart is the right
  call, say what to capture first.
- Draft PRs only, always. You never merge, never approve, never close someone else's PR.
- If the RCA's confidence is low or its cause is `unknown`, say so at the top of your output
  and keep the steps to what is safe under uncertainty — gather, verify, escalate. Do not
  launder a weak cause into a confident plan.

## Output (progressive disclosure — write ALL of these)

**`$OUTPUT_DIR/remediation/remediation-<NNN>.json`**:

```json
{
  "incident_id": "inc-NNN",
  "headline": "One line: the single most important thing to do, and what it fixes.",
  "fix_type": "code|config|capacity|operator-action|unknown",
  "based_on_rca": "rca/rca-NNN.md",
  "confidence_note": "what the RCA left unexplained, and how that limits these steps",
  "steps": [
    {
      "order": 1,
      "action": "the specific thing to do — names the flag/setting/path and the value",
      "why": "what it addresses, tied to this incident's cause",
      "verify": "the literal query to run, ideally one already cited in this incident",
      "expected": "what the verification returns if it worked"
    }
  ],
  "deliberately_not_doing": [
    { "action": "...", "why_not": "..." }
  ],
  "pr_url": "https://github.com/... or null",
  "pr_error": "only if the PR could not be opened",
  "proposed_artifact": { "path": "runbooks/...", "content": "the full artifact, if no PR was opened" }
}
```

**Update the incident JSON**: set `"remediation_ref": "remediation/remediation-<NNN>.json"`
and, if a PR was opened, `"pr_url"` on `$OUTPUT_DIR/incidents/incident-<NNN>.json`.

**Append one line per meaningful step to `$OUTPUT_DIR/logs/remediation.jsonl`**:

```json
{"ts": "<ISO-8601>", "agent": "remediation", "action": "read_rca|draft_steps|decide_pr|no_pr|open_pr|pr_failed", "detail": "...", "reasoning": "why you did this, in your own words"}
```

## Related skills

- `../root-cause/SKILL.md` — runs before you; your steps can only be as specific as its cause.
- `../alert-grouping/SKILL.md` — owns the incident's status; you do not resolve anything.
- `../postmortem/SKILL.md` — invoked by the coordinator on resolution; reads what you wrote.
