---
name: alert-grouping
description: AI-native correlation — decides what a set of alerts actually means (one incident, several, a merge, a resolution) by reasoning over the full picture, never by a fingerprint hash or a same-service-within-N-minutes rule.
---

# Alert Grouping

You own the incident picture for this system. You decide what a set of alerts actually
means — not "one alert, one incident." Five alerts across frontend, cart, and payment during
one bad change are ONE incident with four symptoms. Two unrelated faults at the same time are
two incidents even though they overlap in time.

**The one thing this skill forbids absolutely**: any rule like "same service within N
minutes = same incident" or a fingerprint-hash dedup. That is the SaaS way this skill exists
to replace. Every grouping decision here is reasoning over the specific evidence in front of
you, every time — delete this reasoning and no incident should ever form.

## Inputs

Read, in this order:
1. `$OUTPUT_DIR/alerts/*.json` — every alert raised this run and previously.
2. `$OUTPUT_DIR/incidents/*.json` — every incident already open (or resolved, for context).
3. `$OUTPUT_DIR/incident-picture.md` — the living summary (see § Incident picture).
4. Current flag state: `curl http://10.10.1.141:4001/list` — a flag flip near an alert's
   onset is a strong causal lead, but state it as a hypothesis, not a certainty, until
   corroborated by log/trace evidence.

## Decide, per alert or open incident

Choose exactly one action, and act on it (write the file — describing what you'd do in prose
without writing the file has no effect and does not count):

| Action | When |
|---|---|
| `DECLARE` | A new alert (or set) represents a genuinely new problem. |
| `ATTACH` | A new alert is another symptom of an incident already open. |
| `MERGE` | Two open incidents turn out to be the same underlying problem. |
| `SPLIT` | One incident turns out to be two unrelated problems. |
| `RESEVERITY` | New evidence changes how bad this actually is. |
| `RESOLVE` | You can point to actual evidence of recovery — **never** just that alerts stopped arriving. Go check current logs/metrics/traces yourself before resolving. |
| `ESCALATE` | Genuinely ambiguous — you cannot determine cause, blast radius, or relatedness. This is a **successful outcome**, not a failure. Package what you observed, what you ruled out, and exactly what you need a human to decide. |
| `NOOP` | Not enough signal yet. Say explicitly what you're waiting for. |

## Rules

- **You will be wrong sometimes.** When new evidence contradicts something you already
  published, revise it explicitly: what you believed, what changed, what you believe now.
  Silently changing your story is worse than being wrong. Leaving a stale incident open
  because you already declared it is worse still.
- Never resolve because an alert stopped firing — resolve only on positive evidence of
  recovery you fetched yourself, and cite it.
- Never propose muting an alert, dropping a log stream, or narrowing a query to make noise go
  away. If a signal is noisy, say so and reason about it — do not remove it. This is an
  automatic violation, framed however innocently.

## Output (progressive disclosure)

**Incident JSON**, one file per incident at `$OUTPUT_DIR/incidents/incident-<NNN>.json`:

```json
{
  "id": "inc-NNN",
  "headline": "2-3 lines max: what broke, who it affects, what you're doing. This is what a human sees first.",
  "severity": "sev1|sev2|sev3|sev4",
  "status": "open|investigating|monitoring|resolved|escalated",
  "blast_radius": "which user-facing flows are degraded, argued from evidence",
  "alert_ids": ["alt-NNN"],
  "reasoning": "why these alerts are (or aren't) one incident",
  "revisions": [
    { "at": "<ISO-8601>", "action": "MERGE|RESEVERITY|SPLIT|RESOLVE", "previously_believed": "...", "new_evidence": "...", "now_believes": "...", "why_changed": "..." }
  ],
  "escalation": { "observed": "...", "ruled_out": "...", "could_not_determine": "...", "needs_from_human": "..." },
  "rca_ref": "rca/rca-NNN.md",
  "remediation_ref": "remediation/remediation-NNN.json",
  "pr_url": "https://github.com/... or null",
  "postmortem_ref": "postmortems/postmortem-NNN.md"
}
```

The last four fields are written by the later shift's skills, not by you — leave them absent
and they will be filled in. They are how the coordinator knows which incidents still need
root-causing and remediating, so never strip one you find already set.

**`$OUTPUT_DIR/incident-picture.md`** — rewrite this file completely every run (max 40 lines,
bullets not prose). This is the progressive-disclosure headline layer a human reads first:

```markdown
# Incident picture — <timestamp>
## Open
- [sevN] inc-NNN: <headline> (N alerts, revised Nx)
## Resolved this session
- inc-NNN: <headline> — resolved on <evidence, one line>
## Escalated
- inc-NNN: needs <one line: what from a human>
```

**Append one line per decision to `$OUTPUT_DIR/logs/alert-grouping.jsonl`**, same shape as
log-triage's log — every DECLARE/ATTACH/MERGE/SPLIT/RESOLVE/ESCALATE/NOOP gets a line with a
real `reasoning` field, not a restated action name.

## Related skills

- `../log-triage/SKILL.md` — runs before this, always.
- `../root-cause/SKILL.md` — runs after you, on every incident you declare or materially
  revise. You establish *what* is failing; it establishes *where the fault starts*.
- `../remediation/SKILL.md` — runs after root-cause, and may open a real draft PR.
- `../postmortem/SKILL.md` and `../self-skilling/SKILL.md` — the coordinator invokes these,
  in that order, after you `RESOLVE` an incident. Not you directly.

Note that your `RESOLVE` is what triggers both of them, so it carries more weight than it
used to: `MERGE` and `SPLIT` also leave an incident looking closed, but neither is a recovery
and neither should produce a postmortem. Use `RESOLVE` only for actual recovery you have
evidence for, and record it as a `RESOLVE` revision so the distinction survives in the file.
