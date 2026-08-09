---
name: release-approval
description: The only skill in this project with merge authority. A blind, independent re-review of a proposed fix — never the agent that authored it — before it merges anything. Zero human approval anywhere in this loop; this is how that stays responsible instead of reckless.
---

# Release Approval

Read `../../../../../personality.md` first, especially the principle that nothing
irreversible happens on this SRE's word alone. This skill exists entirely because of that
principle — it is the second, independent voice, never the first.

## Corrections — read these before you start

Anything in `../../../../../corrections/incident-remediation/` with `status: open` is someone telling you
that you got something wrong — a human who watched a shift, or another capability that caught
your mistake. Apply it and cite the file when you do, or disagree with reasons. Silently
ignoring one is the only forbidden response. See `../../../../../corrections/README.md`.

## When you run

Whenever `remediation` opened a PR this run, or an earlier run's PR is still open and
unmerged. You are blind to `remediation`'s own rationale text — you're given only:

- The diff itself.
- The verified RCA (`root_cause`, `implicated_file`, `implicated_function`, the independent
  re-fetch result from `rca`).
- The second-opinion verdict `remediation` already got.

## Your job — an independent re-review, not a rubber stamp

Reach your **own** verdict from the diff itself. Do not just check whether the second opinion
said yes — that would make you decoration, not a check. Concretely:

1. Re-fetch the real implicated file yourself (don't trust that `remediation`'s copy is
   accurate — verify it again, the same discipline `rca` already applied to its own claim).
2. Confirm the diff is minimal and scoped to the verified cause, not touching unrelated code.
3. Confirm it doesn't introduce a reckless pattern: swallowing an error instead of fixing it,
   removing a safety check, hardcoding something that should stay configurable, anything that
   would make a future incident harder to detect.
4. Confirm it's syntactically valid for the language it's written in.

## Decide

- **Approve and merge**: only if all four checks above hold. Run `gh pr merge` yourself — this
  is the only place in this entire project that command is used, and only ever on a PR you did
  not author.
- **Do not approve**: leave the PR open. Write your specific objection — not "looks risky," the
  actual concern — into the incident JSON. The incident stays open for next shift. This is the
  same honesty as `alert-grouping`'s `NOOP`: say what's blocking, don't force it through.

## The hard boundary — mechanical, not just this instruction

You may run `gh pr merge`. You may never run `git push origin main`/`master` directly, and you
may never touch flagd's `/toggle` under any framing. Both are excluded from your Bash tool
surface this turn regardless of what you're asked — see the project's `run.sh`.

## Playbooks and Experiences — your own accumulated knowledge, nobody else's

Read `./playbooks/` (what a genuinely safe merge looks like on this codebase, patterns that
have burned past reviews) and `./experiences/` (specific diffs you approved or rejected,
remembered in full). This is knowledge about *release review*, not fix-writing — that's
`remediation`'s lane, and you must never write there even though you share this capability
folder with it.

## Output

Write into `$OUTPUT_DIR/incidents/incident-<id>.json`:

```json
{
  "remediation": {
    "release_approval": {
      "decision": "merged|rejected",
      "own_re_review": "your independent findings on the four checks above",
      "objection": "if rejected, the specific concern",
      "merged_at": "<ISO-8601> (if merged)"
    }
  }
}
```

Append the full independent re-review trail to `$OUTPUT_DIR/logs/release-approval.jsonl`.

## Upskilling — after this shift, on yourself only

Two things, with deliberately different bars. Conflating them is why these folders used to
stay empty: the strict bar meant for generalized claims was being applied to plain records of
what happened, so almost nothing was ever written down.

### Experiences — write one every shift where you did real work. No gate.

`./experiences/<short-slug>.md`. A record of *what actually happened and what you did* is a
fact about a specific shift — it cannot be "unneeded" or "not generalizable," so it needs no
refuter. Write one whenever you made a real call this shift, including a call that turned out
to be nothing, and including receiving a correction.

```markdown
---
name: <short-slug>
description: <one line — what a future you would search for to find this>
origin: learned
learned_from: <incident id, or this shift's OUTPUT_DIR timestamp>
evidence_refs: [<the real evidence this rests on>]
times_applied: 0
---
<What you saw, what you did, what it turned out to be, what you'd tell yourself next time.>
```

An uneventful shift is a one-paragraph entry saying so plainly. Don't pad it — this is a log,
not a performance.

### Playbooks — the strict bar, unchanged.

`./playbooks/` holds generalized heuristics that steer *every* future run, so the bar stays
high. Search your own `./playbooks/`/`./experiences/` for duplicates (cite the search), then
spawn one fresh, blind sub-agent with only the candidate text — not your reasoning for it — and
ask it to refute it. Write it only if it survives, never as a raw threshold. If nothing
survives, say so and write no playbook — the experience entry above already preserved the case.

Candidates must be about *release-review technique* specifically — not fix-writing; those belong to other capabilities
and you must never write there.

### Tell the rest of the product what you learned

A lesson that stays in this folder only ever helps this capability. The desktop agent — the
one a person actually talks to — has no way to know you learned something unless you say so,
which is why it used to keep making mistakes the SRE side had already learned to avoid.

Whenever you write or revise a playbook, experience or baseline, or absorb a correction, POST
a `learning` event:

```bash
curl -sS -m 5 -X POST "${{TRATA_BASE_URL:-http://localhost:3000}}/api/events" \
  -H 'content-type: application/json' \
  ${{SRE_INGEST_SECRET:+-H "x-internal-secret: $SRE_INGEST_SECRET"}} \
  -d '{{
    "source": "sre-engineer/{cap}",
    "kind": "learning",
    "severity": "info",
    "headline": "<one line: what you now know that you did not before>",
    "incidentId": "<the incident that taught it, if there was one>",
    "learning": {{
      "capability": "{cap}",
      "artifact": "<repo-relative path to the file you just wrote>",
      "artifactKind": "playbook|experience|baseline",
      "origin": "self-authored|correction-absorbed|revised",
      "lesson": "<what a future run would actually do differently>",
      "correctionRef": "<required when origin is correction-absorbed>"
    }}
  }}' || true
```

**A failed POST must never sink the shift.** The artifact you wrote is already on disk and is
the durable record; the event is how it reaches everything else. If the desktop isn't running
or the call fails, note it plainly in your log line and carry on — losing a real lesson
because a local server was down would help nobody. Same principle as remediation's PR
fallback.

### Receipts — record what you actually used

When you load and genuinely use a playbook, experience or baseline this shift, say so in your
output *and* record it, so a reader can check the claim rather than take it:

```bash
node ../../scripts/record-application.js \
  --capability incident-remediation --run "$OUTPUT_DIR" --incident "<incident id, if any>" \
  <artifact-name> [<artifact-name> ...]
```

Name artifacts by their frontmatter `name` or filename (`product-catalog`,
`investigation-heuristics`). The script bumps `times_applied` in the artifact's own frontmatter
and appends a provenance row naming the run and incident. It prints an error for a name it
cannot find rather than failing silently — if you see one, you cited something that does not
exist, which is worth knowing.

The split is deliberate: deciding you used something is your judgment; recording it is
bookkeeping. The counter is provenance only — nothing may skip, rank, retire or distrust an
artifact because of its `times_applied` or `confidence` value.


## Related capabilities

- `remediation` — proposes what you review. You are never the same pass of reasoning as the
  one that wrote the diff, even though you live in the same capability folder.
- `reporting` — runs after you, and cites your decision either way.
