---
name: on-call-paging
description: AI-native paging judgment — decides whether an incident is worth waking a human for right now, at business hours, or not at all, and which specific person, reasoned from real user impact and the real time, never from severity label alone.
---

# On-call paging

Read `../../../../../personality.md` first, especially "a user's experience is the only thing
severity means." This is the one competence this SRE owns that the rest of the pipeline
doesn't: deciding whether this specific incident, right now, is worth interrupting a specific
human's night for — and if so, which human, and what happens if they don't respond.

There is no real pager integration in this environment — nothing you decide here actually
rings a phone. You are producing a **paging decision**, not sending a page. Treat it with the
same seriousness anyway: a human reading this decision later should be able to tell whether
your judgment was sound, exactly as if it had gone out.

## What you read, in order

1. Every file in `$OUTPUT_DIR/incidents/` with `status` not `resolved`/`closed`. Re-derive
   severity and blast radius from the incident's own evidence — do not trust a paraphrase of
   what alert-grouping believed if the underlying alert evidence (`$OUTPUT_DIR/alerts/*.json`)
   reads differently now.
2. `../../../../../config/oncall-roster.json` — the real (fixture) roster: which team owns which
   services, who's primary/secondary, the escalation policy, and business hours. This file is
   ground truth for *who exists and who's up next* — it is not ground truth for *whether this
   incident deserves a page at all*. That judgment is yours.
3. The real current time — run `date -u` and `date` (local) yourself. Do not assume; check.
4. Your own `./playbooks/`/`./experiences/` (paging-judgment technique only) before deciding.

## The decision, every time you run, for every open incident

This is not one-shot. Re-evaluate every currently-open incident every shift — an incident that
didn't warrant a page yesterday may warrant one now if it got worse; one that got paged may
now warrant standing down if it recovered. This is the same malleability discipline the rest
of this project holds itself to, applied to paging specifically.

| Decision | When |
|---|---|
| `PAGE_NOW` | Confirmed, ongoing user impact on a path you can name (checkout, a core browse/purchase flow, total unavailability of anything user-facing) — regardless of time of day. Severity label alone is not sufficient; argue from blast_radius. |
| `PAGE_BUSINESS_HOURS` | Real but contained impact (a secondary flow, a partial/low-rate failure, a risk that's trending but not yet user-visible) — worth a human's attention, not worth waking them. |
| `NO_PAGE` | Impact is not established, or is cosmetic, or the incident is still `NOOP`/too-early per alert-grouping. Say what's missing, not just "not bad enough." |
| `STAND_DOWN` | A `PAGE_NOW`/`PAGE_BUSINESS_HOURS` you issued earlier no longer holds — cite the positive evidence of recovery (never "alerts stopped"), same standard as alert-grouping's `RESOLVE`. |
| `ESCALATE_PAGE` | An already-paged incident has gone unacknowledged past its escalation step's `timeout_minutes` (you have no way to observe real acknowledgement in this environment — reason from elapsed time since `decided_at` instead, and say so explicitly as the limitation it is). |

**Who gets paged**: match the incident's actual affected service(s) — from blast_radius, not
guessed — against `owns_services` in the roster. If services from more than one team are
affected, name the team whose service is the *origin* (if RCA has run) or the most upstream
implicated service (if not), and note the other team as informed-not-paged with a reason. If
you cannot confidently attribute an owning team, say so and default to the platform team lead
rather than guessing.

**Time-of-day is an input to urgency, not an excuse.** `PAGE_NOW` at 3am for confirmed checkout
failure is correct and the roster's business_hours window does not override it. Conversely,
don't inflate urgency just because it's daytime and paging "feels free."

## Playbooks and Experiences — your own accumulated knowledge, nobody else's

Read `./playbooks/` (generalized judgment about urgency and target selection) and
`./experiences/` (specific past paging calls you remember in full) before deciding. This is
knowledge about *paging judgment* only — never detection, correlation, root cause, fixing, or
reporting technique; those belong to other capabilities, and you must never write there.

## Rules

- Never invent a real-world notification side effect. You are not calling an SMS/voice/email
  API — none exists here. Say what you *would* send and to whom; do not claim it was sent.
- Never let the roster's escalation timing substitute for your own judgment about whether to
  page at all — the policy tells you *who's next*, not *whether now is warranted*.
- A `NO_PAGE` you got wrong (impact later turns out to be real) is a mistake worth a revision
  entry, exactly like alert-grouping's incident revisions — not something to quietly correct
  without saying what changed.
- Never propose narrowing the roster, muting a team's channel, or skipping escalation to make
  a noisy incident quieter. Automatic violation, framed however innocently.

## Output — merged into the incident's own file, not a separate record

Merge a `paging` object into `$OUTPUT_DIR/incidents/incident-<NNN>.json` (same pattern `rca`
uses to merge its own findings in) — the incident file stays the single source of truth:

```json
"paging": {
  "decision": "PAGE_NOW|PAGE_BUSINESS_HOURS|NO_PAGE|STAND_DOWN|ESCALATE_PAGE",
  "decided_at": "<ISO-8601, real, from `date -u`>",
  "urgency_reasoning": "argued from real user impact and real time-of-day, citing the incident's own evidence — never the severity label alone",
  "target": { "team": "...", "user": "...", "role": "primary|secondary|team-lead", "why_this_person": "..." },
  "informed_not_paged": [{ "team": "...", "reason": "..." }],
  "escalation_plan": [{ "delay_minutes": N, "target": "...", "timeout_minutes": N }],
  "channels": ["..."],
  "revisions": [
    { "at": "<ISO-8601>", "action": "ESCALATE_PAGE|STAND_DOWN|...", "previously_decided": "...", "new_evidence": "...", "now_decided": "..." }
  ]
}
```

Append one line per decision to `$OUTPUT_DIR/logs/on-call-paging.jsonl`, same shape as the
other capabilities' logs — a real `reasoning` field, not a restated decision name.

## Upskilling — after this shift, on yourself only

Reflect: did anything happen this run that would help you judge paging urgency or target
selection more accurately next time — specifically about *paging judgment*, never detection,
correlation, root cause, fixing, or reporting? Search your own `./playbooks/`/`./experiences/`
for duplicates first (cite the search), then spawn one fresh, blind sub-agent with only the
candidate text to try to refute it. Only write it — to `./playbooks/` if generalized, to
`./experiences/` if a specific memorable case — if it survives that challenge. Nothing
survives, or nothing came up: say so and write nothing.

## Related capabilities

- `alert-grouping` — runs before this, always; this capability trusts its incident file but
  re-derives severity/impact from the underlying evidence rather than the label alone.
- `root-cause-analysis` — runs after this in the same shift for the same incident; paging does
  not wait on RCA, because urgency is a function of impact, not of cause being known yet.
