---
name: postmortem
description: AI-native postmortem — writes the incident's account of itself when it resolves: what happened, what the evidence was, where the agent's own belief changed and why, and what would have caught it sooner. Assembled from this incident's real artifacts, never a template filled in.
---

# Postmortem

Invoked by the coordinator (never by another skill directly) once `alert-grouping` has
genuinely **RESOLVE**d an incident. You write the document a human reads a week later, and
the only material you use is what this incident actually produced: its alerts, its evidence,
its RCA, its remediation, and its own revision history.

Delete every reasoning step here and nothing should come out — no narrative, no timeline, no
lesson. Assembling the artifacts is not the work; deciding what they mean is.

**The one thing this skill forbids absolutely**: a template. If a section would read the same
for a different incident, cut it. Every sentence has to trace to a real timestamp, query,
value, log line or trace ID sitting in this run's files — that is the pass bar in
`docs/04-testing-your-incident-flow.md`, and it is checkable, so it will be checked.

## Only a real resolution counts

`MERGE` and `SPLIT` also leave incidents with a resolved-looking status: the incident merged
away, and the incident that was split, are both closed out without anything having recovered.
Neither gets a postmortem. Write one only where the incident's own `revisions` carry a
`RESOLVE` action with recovery evidence behind it. Getting this wrong produces postmortems
about events that never happened, which discredits the ones about events that did.

## Inputs

Read all of these before writing a line:
1. `$OUTPUT_DIR/incidents/incident-<NNN>.json` — especially `revisions`. This is the record
   of what the agent believed over time, and it is the most valuable thing in the folder.
2. `$OUTPUT_DIR/alerts/*.json` for this incident — detection times, evidence, and the
   `disconfirming_checks` that show what was ruled out along the way.
3. `$OUTPUT_DIR/rca/rca-<NNN>.md` and `$OUTPUT_DIR/remediation/remediation-<NNN>.json`, if
   they exist. If they do not, say that plainly in the postmortem rather than reconstructing
   a cause here — this skill documents the investigation, it does not perform one.
4. `$OUTPUT_DIR/logs/*.jsonl` — the reasoning trails. Real timestamps for the timeline live
   here, as does the honest account of what was tried and abandoned.

## How to work

1. **Build the timeline from real timestamps only.** First evidence of the fault, first alert,
   declaration, each revision, resolution. If you cannot source a time from an artifact, leave
   it out — an invented "approximately 08:15" in a document whose whole claim is
   traceability is a self-inflicted wound.
2. **Quantify impact from evidence that already exists.** Failure rates, affected flows,
   duration. If the numbers came from synthetic load rather than real users, say so; an
   honest impact statement is more useful than an impressive one.
3. **Write the belief-change section properly.** Each revision: what was believed, what
   arrived, what is believed now, and what the tell was. An incident that ran start to finish
   with no revision is worth one line saying the first read held — do not manufacture drama.
4. **Be specific about what was wrong.** If severity was set too low for twenty minutes, if a
   service was blamed before the trace corrected it, if a quiet window was nearly mistaken
   for recovery — write it. A postmortem that makes its author look good teaches nobody
   anything, and this one has no career to protect.
5. **Make "what would have caught this sooner" concrete and non-generic.** Not "improve
   monitoring". The specific signal that moved before anything alerted, the specific query
   that would have surfaced it, the specific reason it was not being looked at.
6. **Separate what is known from what is inferred**, explicitly, wherever the evidence
   supports a reading rather than proving it.

## Rules

- Every claim cites its artifact — the alert id, the query, the trace ID, the log line. A
  claim with nothing behind it does not go in.
- No blame. The subject is the system and the response, never a person or a team.
- Action items are specific enough to act on and tied to this incident. "Add alerting" is not
  an action item; naming the signal, the query and who would own it is.
- Never propose reducing observability as a lesson learned — no muting the noisy alert, no
  narrowing the query, no dropping the chatty stream. An incident is never evidence that the
  system should see less.
- The postmortem is a document, not a decision. It never changes an incident's status,
  reopens anything, or opens a PR.

## Output (progressive disclosure — write ALL of these)

**`$OUTPUT_DIR/postmortems/postmortem-<NNN>.md`**:

```markdown
# Postmortem — inc-NNN: <short title>

**Severity** sevN · **Detected** <ts> · **Declared** <ts> · **Resolved** <ts> · **Open for** <duration>
**Root cause** <one line> · **Fix** <one line, or "operator action — no code change">
<PR link, if one was opened>

## What happened
<3-5 lines. A reader who stops here should still know what broke, why, and how it ended.>

## Impact
<Who or what was degraded, quantified from evidence already gathered, with the source cited.>

## Timeline
| Time (UTC) | Event | Source |
|---|---|---|
| <ts> | <what happened> | <alert id / query / log ref> |

## Root cause
<From the RCA, with the evidence that settled origin vs. victim.>

## How it was resolved
<The recovery evidence cited in the RESOLVE revision — the query, and its before and after.>

## What the agent believed, and when it changed its mind
<One entry per revision: believed → evidence arrived → now believes → what the tell was.
If there were no revisions, say the first read held, in one line.>

## What would have caught this sooner
<Specific. The signal, the query, and why it was not being watched.>

## Action items
- [ ] <specific, tied to this incident, actionable by a named surface>

## Evidence index
<Every artifact this document draws on: alert files, rca, remediation, jsonl logs, trace IDs.>
```

**Append a `## Postmortem` line to `$OUTPUT_DIR/incident-picture.md`**, under the resolved
incident:
`- inc-NNN: postmortems/postmortem-NNN.md — <the single most important lesson, one line>`

**Update the incident JSON**: set `"postmortem_ref": "postmortems/postmortem-<NNN>.md"`.

**Append one line per meaningful step to `$OUTPUT_DIR/logs/postmortem.jsonl`**:

```json
{"ts": "<ISO-8601>", "agent": "postmortem", "action": "read_artifacts|build_timeline|assess_impact|belief_trail|lessons|write|skip", "detail": "...", "reasoning": "why you did this, in your own words"}
```

A `skip` line with its reasoning is the correct output when the incident closed via MERGE or
SPLIT rather than a real resolution — record the decision, do not silently do nothing.

## Related skills

- `../alert-grouping/SKILL.md` — owns resolution; its `RESOLVE` revision is your trigger.
- `../root-cause/SKILL.md`, `../remediation/SKILL.md` — the material you draw on.
- `../self-skilling/SKILL.md` — runs after you, and can read what you wrote. Your "what would
  have caught this sooner" section is the strongest harvest material in the folder.
