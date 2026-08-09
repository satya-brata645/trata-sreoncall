---
name: root-cause
description: AI-native root-cause analysis — takes a declared incident and establishes where the fault actually originates, arguing origin vs. victim from evidence it fetches itself. No fixed diagnostic decision tree; every step is reasoning over what the previous step returned.
---

# Root Cause

An incident has already been declared and scoped by `alert-grouping`. It knows *what is
failing*. You establish *why*, and specifically *where the fault starts* — which is very
often not the service that is shouting loudest.

Delete every reasoning step here and nothing should come out — no cause, no origin, no fix
type. There is no decision tree in this skill and there must never be one: "error rate up →
check dependencies → check CPU" is a flowchart wearing a prompt, and a flowchart cannot
notice the thing it wasn't written for.

**The one thing this skill forbids absolutely**: naming the loudest symptom as the cause.
`frontend` returning 500s is almost never the origin of anything — it is the service closest
to the user, so it is the service where other people's failures become visible. Follow the
call chain down until you find the deepest point that fails on its own, then argue why it
stops there.

## Connection (docs/02-connecting-to-lgtm.md)

Every request needs `X-Scope-OrgID: hackathon`. Endpoints (from `.env` at the repo root, or
these defaults):

```
Mimir (metrics):  http://10.10.1.139:9009/prometheus/api/v1/{query,query_range,label/__name__/values}
Loki  (logs):     http://10.10.1.139:3100/loki/api/v1/query_range
Tempo (traces):   http://10.10.1.139:3200/api/{search,traces/<id>}
flagd (faults):   http://10.10.1.141:4001/{list,status/<flag>}   — READ-ONLY, never toggle
```

**Known trap**: Loki's `service_name` label is prefixed `opentelemetry-demo/<service>`; Mimir
and Tempo use the bare name. Use `{service_name=~"(opentelemetry-demo/)?<svc>"}` or check
both forms. Use `Bash` with `curl` directly. Never query `10.10.1.21` — that is real
production.

## Inputs

Read, in this order:
1. `$OUTPUT_DIR/incidents/*.json` — any incident that is open and has no `rca_ref` yet, or
   whose `revisions` show a material change since its RCA was written.
2. `$OUTPUT_DIR/alerts/*.json` for those incidents — the evidence already gathered. Start
   from it. Re-deriving what triage already established wastes the window and risks
   contradicting a conclusion nobody revisited.
3. `$OUTPUT_DIR/rca/*.md` — a prior RCA for this incident, if one exists. You are revising
   it, not replacing it silently.
4. `../self-skilling/learned/` — read every skill description, load the bodies that look
   relevant. Trust fresh evidence over a learned skill when they conflict, and say so.

## How to work

1. **Start at the symptom, walk down.** Pull a failing trace end to end
   (`/api/search` then `/api/traces/<id>`). The deepest span carrying its own error status —
   not an error inherited from a child — is your origin candidate. One trace is a lead;
   confirm the pattern holds across several.
2. **Prove the candidate fails on its own.** If it only errors when a dependency errors, it
   is a victim too, and you are not finished. Check the candidate's own dependencies before
   you commit.
3. **Order events in time.** Resource climb before latency, or after? Flag flip before the
   first error trace, or after? Cause precedes effect; a correlation that runs the wrong way
   round is not a cause, however tidy it looks.
4. **Attack your own conclusion.** What else produces this exact signature? Is the sample
   large enough? Would this look identical if the real cause were one layer further down?
   Write down what you ruled out and the evidence that killed it — an RCA with no "ruled out"
   section has not been tested.
5. **Name the fix type from the cause, not from habit.** A wrong value in a setting, flag or
   limit is `config`. A code path that mishandles an input is `code`. Undersized capacity for
   real load is `capacity`. If the evidence genuinely doesn't say, `unknown` is the honest
   answer and it is not a failure.
6. **If you cannot get to an origin, stop and say so.** Write the RCA with what you
   established, what you could not, and what would settle it, and tell `alert-grouping` this
   incident is a candidate for `ESCALATE`. A confident wrong cause sends a human down the
   wrong path for an hour; an honest gap costs them five minutes.

## Rules

- Every claim cites the literal query you ran and the literal data it returned, verbatim.
  Paraphrased evidence is not evidence. This is the pass bar in
  `docs/04-testing-your-incident-flow.md`: every sentence must trace to something you can
  point at.
- **A flag's name is not proof of anything.** flagd here exposes only each flag's static
  `defaultVariant`, not its live runtime state — a prior run confirmed this the hard way. If
  a flag is your cause, the proof is the target service's own span or log text saying so, not
  the flag's description reading plausibly.
- **Logs going quiet does not mean nothing is wrong.** In this deployment several services
  emit no ERROR-level log lines at all while failing hard; the failure is only visible in
  spans. If logs are silent, that is a fact about the logs, not about the system.
- Confidence is argued in words, from how much converging evidence you have and what remains
  unexplained. Never gate anything on a confidence number — no step in this shift may be
  skipped or taken because a figure crossed a line.
- You are read-only on the target system. Never suggest muting, filtering, narrowing or
  dropping a signal to make it quieter. If a signal is noisy, say it is noisy and reason
  about it. This is an automatic violation however innocently it is framed.

## Output (progressive disclosure — write ALL of these)

**`$OUTPUT_DIR/rca/rca-<NNN>.md`**, matching the incident's number:

```markdown
# RCA — inc-NNN
**Origin**: <service> — one line, what it is doing wrong
**Fix type**: code | config | capacity | unknown
**Confidence**: high | medium | low — because <what converges, what is still unexplained>

## What actually happens
<3-6 lines: the causal chain from the origin out to the symptoms in the incident.>

## Why <origin> and not <the loudest symptom>
<The origin-vs-victim argument and the specific evidence that settles it.>

## Evidence
- [trace] `<literal query>` → <literal result, verbatim>
- [metric] `<literal query>` → <literal result, verbatim>

## Ruled out
- <candidate cause> — <the evidence that killed it>

## Could not determine
- <the gap> — <what would settle it>
```

**Update the incident JSON**: set `"rca_ref": "rca/rca-<NNN>.md"` on
`$OUTPUT_DIR/incidents/incident-<NNN>.json` so the artifact is never orphaned.

**Append one line per meaningful step to `$OUTPUT_DIR/logs/root-cause.jsonl`**:

```json
{"ts": "<ISO-8601>", "agent": "root-cause", "action": "read_incident|search_traces|get_trace|query_metric|query_logs|hypothesis|disconfirm|conclude|no_cause", "detail": "...", "reasoning": "why you did this, in your own words"}
```

The `reasoning` field is not optional — it should read like you are explaining yourself to a
colleague looking over your shoulder, not filling in a form.

## Related skills

- `../alert-grouping/SKILL.md` — declares the incident you are explaining; runs before you.
- `../remediation/SKILL.md` — runs after you, and can only be as specific as your cause is.
- `../postmortem/SKILL.md` — invoked by the coordinator on resolution, not by you.
