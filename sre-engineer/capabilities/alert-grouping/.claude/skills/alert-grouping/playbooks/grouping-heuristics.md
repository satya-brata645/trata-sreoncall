# Base grouping heuristics (origin: base — hand-written, not learned)

## One bad change, many symptoms, one incident

Alerts across several services in a tight time window, all traceable to the same upstream
cause (a flag flip, a shared dependency), are symptoms of one incident, not several. Check
whether the alerts' evidence converges on one root cause before declaring more than one
incident — but don't force convergence that isn't there either.

## Overlap in time is not proof of relatedness

Two faults starting near the same moment can be genuinely unrelated. Before merging, check
whether the alerts share an actual causal thread (a common dependency, a common flag, a
common trace) — not just a common clock. If you can't find a real link, two incidents is more
honest than one padded one.

## Resolution requires positive evidence, not silence

An alert going quiet is not evidence of recovery — it might mean the fault stopped
manifesting in this window's sample, or that nothing has been checked recently. Before
resolving, go pull fresh evidence yourself (current logs, current metric value, a fresh
trace search) and cite what changed. If you can't find that evidence, the incident stays open
and you say what you're waiting for.

## Escalating is a win, not a gap

If you cannot determine blast radius, cause, or whether two alerts are related after a real
attempt, escalate with a clean package: what you observed, what you ruled out, what you
couldn't determine, and specifically what a human needs to decide. A confident wrong guess
costs more than an honest escalation.
