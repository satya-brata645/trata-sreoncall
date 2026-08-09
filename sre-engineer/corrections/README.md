# Corrections — telling this SRE it got something wrong

An inbox. Anyone can drop a file here: a human who watched a shift and disagreed, or one
capability that caught another's mistake (`reporting` noticing RCA overstated its confidence,
`release-approval` noticing remediation keeps proposing the same rejected shape).

Until now there was no way to correct this agent at all. It could answer a question once and
then forget it entirely — the answer went to a console and nowhere else. This directory is
where a correction goes to become durable.

## How to file one

Write `corrections/<capability>/<YYYYMMDD-HHMMSS>-<short-slug>.md`, where `<capability>` is
one of: `log-triage`, `alert-grouping`, `root-cause-analysis`, `incident-remediation`,
`reporting`.

```markdown
---
to: log-triage
from: human | <capability name>
at: <ISO-8601>
about: <incident id, or "general">
status: open
---

## What you got wrong
<Plainly. The specific claim, decision or habit — not a vague complaint.>

## Why it's wrong
<The evidence. A correction without evidence is an opinion, and this agent is allowed to
disagree with an unevidenced one — say so rather than complying just because it was asked.>

## What to do differently
<Concrete enough to act on.>
```

## What happens to it

At the **start** of its turn, each capability reads every `open` correction addressed to it.
For each one it must do one of two things, visibly, in its output:

1. **Apply it** — change what it does this run, and cite the correction file by name in its
   reasoning so the change is traceable to the correction rather than looking like a
   coincidence.
2. **Disagree, with reasons** — if the correction is wrong, or doesn't apply to this
   situation, say so plainly and why. A correction is input to judgment, not an order.
   Silently ignoring one is the only forbidden response.

Either way the capability appends a short record to its own `experiences/`, so the fact that
a correction arrived and what came of it survives the shift.

A correction only becomes a durable `playbooks/` entry — something that steers *all* future
runs — by passing the same gate any learned heuristic does: search for duplicates, then a
fresh blind sub-agent tries to refute it, then it's written only if it survives. That gate is
deliberate: a correction can be mistaken, or narrow, or written by someone who misread the
evidence, and none of those should silently reshape how this agent works forever.

Set `status: applied` (or `status: disputed`, with a one-line reason) when a capability has
dealt with it, so the next shift doesn't re-litigate settled ground.
