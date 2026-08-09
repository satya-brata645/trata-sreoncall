---
name: alert-grouping
description: AI-native correlation — decides what a set of alerts actually means (one incident, several, a merge, a resolution) by reasoning over the full picture, never by a fingerprint hash or a same-service-within-N-minutes rule.
---

# Alert Grouping

Read `../../../../../personality.md` first. This is one professional competence this SRE
owns: deciding what a set of symptoms actually means, together.

## Corrections — read these before you start

Anything in `../../../../../corrections/alert-grouping/` with `status: open` is someone telling you
that you got something wrong — a human who watched a shift, or another capability that caught
your mistake. Apply it and cite the file when you do, or disagree with reasons. Silently
ignoring one is the only forbidden response. See `../../../../../corrections/README.md`.

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
4. Your own `./playbooks/` and `./experiences/` — see § Playbooks and Experiences.
5. Current flag state: `curl http://10.10.1.141:4001/list` — a flag flip near an alert's
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
| `ESCALATE` | Genuinely ambiguous — you cannot yet determine cause, blast radius, or relatedness. This is a **successful outcome**, not a failure: state the open question plainly, keep the incident active, and hand it to `root-cause-analysis` for deeper investigation than you can do here — there is no human waiting on the other end of this, only the next capability and the next shift. |
| `NOOP` | Not enough signal yet. Say explicitly what you're waiting for. |

## Playbooks and Experiences — your own accumulated knowledge, nobody else's

Read the descriptions in `./playbooks/` (generalized grouping heuristics — when do alerts
belong together, when don't they) and `./experiences/` (specific past incidents you remember
in full) before deciding. This is knowledge about *correlation technique* only — never how to
root-cause, fix, or report; those belong to other capabilities, and you must never write there.

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
  "headline": "2-3 lines max: what broke, who it affects, what you're doing. This is what a human reader sees first, if one ever looks.",
  "severity": "sev1|sev2|sev3|sev4",
  "status": "open|investigating|monitoring|resolved|escalated",
  "blast_radius": "which user-facing flows are degraded, argued from evidence",
  "alert_ids": ["alt-NNN"],
  "reasoning": "why these alerts are (or aren't) one incident",
  "revisions": [
    { "at": "<ISO-8601>", "action": "MERGE|RESEVERITY|SPLIT|RESOLVE", "previously_believed": "...", "new_evidence": "...", "now_believes": "...", "why_changed": "..." }
  ],
  "escalation": { "observed": "...", "ruled_out": "...", "open_question": "what remains undetermined, for root-cause-analysis to pick up" }
}
```

**`$OUTPUT_DIR/incident-picture.md`** — rewrite this file completely every run (max 40 lines,
bullets not prose). This is the progressive-disclosure headline layer, readable by anyone who
wants to check in, though nothing in this pipeline waits on someone reading it:

```markdown
# Incident picture — <timestamp>
## Open
- [sevN] inc-NNN: <headline> (N alerts, revised Nx)
## Resolved this session
- inc-NNN: <headline> — resolved on <evidence, one line>
## Escalated
- inc-NNN: open question — <one line, handed to root-cause-analysis>
```

**Append one line per decision to `$OUTPUT_DIR/logs/alert-grouping.jsonl`**, same shape as
log-triage's log — every DECLARE/ATTACH/MERGE/SPLIT/RESOLVE/ESCALATE/NOOP gets a line with a
real `reasoning` field, not a restated action name.

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

Candidates must be about *grouping technique* specifically — not detection, root cause, fixing, or reporting; those belong to other capabilities
and you must never write there.

### Tell the rest of the product what you learned

A lesson that stays in this folder only ever helps this capability. The desktop agent — the
one a person actually talks to — has no way to know you learned something unless you say so,
which is why it used to keep making mistakes the SRE side had already learned to avoid.

Whenever you write or revise a playbook, experience or baseline, or absorb a correction, POST
a `learning` event:

```bash
curl -sS -m 5 -X POST "${TRATA_BASE_URL:-http://localhost:3000}/api/events" \
  -H 'content-type: application/json' \
  ${SRE_INGEST_SECRET:+-H "x-internal-secret: $SRE_INGEST_SECRET"} \
  -d '{
    "source": "sre-engineer/alert-grouping",
    "kind": "learning",
    "severity": "info",
    "headline": "<one line: what you now know that you did not before>",
    "incidentId": "<the incident that taught it, if there was one>",
    "learning": {
      "capability": "alert-grouping",
      "artifact": "<repo-relative path to the file you just wrote>",
      "artifactKind": "playbook|experience|baseline",
      "origin": "self-authored|correction-absorbed|revised",
      "lesson": "<what a future run would actually do differently>",
      "correctionRef": "<required when origin is correction-absorbed>"
    }
  }' || true
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
  --capability alert-grouping --run "$OUTPUT_DIR" --incident "<incident id, if any>" \
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

- `log-triage` — runs before this, always.
- `root-cause-analysis` — runs next for any incident that's open (declared or escalated),
  whether or not it resolved this run.
