# Baselines — what I've learned "normal" looks like on this system

One file per service, `<service>.md`, written and revised by `log-triage` itself from
telemetry it has actually observed. This directory starts empty on a fresh checkout; every
file in it should trace to real windows this agent swept.

## Why these exist

Without them, every shift starts from zero: it sees a number, has nothing to compare it
against, and has to guess whether it's unusual. A baseline is this agent's accumulated answer
to "what does this service normally look like, and how do I know?" — so the next shift starts
from experience instead of from nothing.

## The hard line: observations and judgment, never a firing rule

This is the one thing that can ruin these files. A baseline records **what I saw and what I
make of it**. It never contains a rule that decides something.

**Fine — an observation, with its evidence:**
> `sum(rate(traces_span_metrics_calls_total{service_name="product-catalog"}[5m]))` returned
> 0.81, 0.94, 1.02 and 1.17 req/s across four quiet windows on 2026-08-09 (08:12, 08:31,
> 09:02, 09:44 UTC). Nothing was failing in any of them.

**Fine — judgment, argued and revisable:**
> A reading meaningfully above that range is worth a closer look, but I've been wrong about
> this once already: on 2026-08-09 the load generator stopped entirely, which made every
> number look "better" while the system was actually less healthy. Low is not automatically
> good — check whether traffic is still arriving before reading anything into a drop.

**Forbidden — a rule that decides:**
> ~~Alert when the rate exceeds 1.2/s.~~
> ~~If error_rate > 0.05, severity = high.~~
> ~~Treat any deviation beyond 2 standard deviations as an incident.~~

The difference isn't the presence of a number — it's whether the number is *evidence I'm
citing* or *a gate that fires*. Numbers as evidence are required. Numbers as triggers are
banned, here and everywhere else in this project.

Nothing in code ever reads these files and compares a value. The only thing that ever reads a
baseline is a model, and the only thing it does with it is reason.

## Format

```markdown
---
name: <service>
observed_windows: <how many real sweeps this is built from>
confidence: low | medium | high
last_revised: <ISO-8601>
revised_because: <what contradicted the previous version — omit on first write>
---

## What I have actually seen
<Real queries and their literal returned values, with timestamps. Never rounded, never
paraphrased — if you can't quote it, don't claim it.>

## What I consider normal, and why
<Your judgment over those observations, argued.>

## What would make me suspicious
<Qualitative. What kind of change would matter, and what it would suggest.>

## What would NOT
<The signals that have fooled me or would fool a careless reader — known-noisy metrics,
streaming spans that inflate p99, a drop that means traffic stopped rather than health
improved. This section is why the file is worth more than a number.>
```

`confidence` and `observed_windows` are informational only — for a reader's judgment and for
your own. **Nothing may gate on them.** "Skip services with confidence: low" or "only trust a
baseline with observed_windows >= 3" would be a threshold deciding behavior, which is exactly
what this whole file forbids.

## Revising

When reality contradicts a baseline, revise the file and say what changed your mind in
`revised_because`. A baseline that never changes on contact with evidence isn't learning,
it's a stale assumption with a timestamp. Never silently overwrite — the point is that a
reader can see the belief move.
