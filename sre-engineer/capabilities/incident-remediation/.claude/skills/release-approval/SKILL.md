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

### Receipts — record what you actually used

When you load and genuinely use a playbook or experience this shift, name it in your output and
increment `times_applied` in that file's frontmatter. That counter is the difference between
"there is a learning mechanism" and "here is something learned that has since been used." It is
bookkeeping, never a gate: nothing may skip, retire or distrust a file because of its
`times_applied` or `confidence` value.

## Related capabilities

- `remediation` — proposes what you review. You are never the same pass of reasoning as the
  one that wrote the diff, even though you live in the same capability folder.
- `reporting` — runs after you, and cites your decision either way.
