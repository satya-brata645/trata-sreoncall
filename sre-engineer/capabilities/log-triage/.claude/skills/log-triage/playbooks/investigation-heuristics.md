# Base investigation heuristics (origin: base — hand-written, not learned)

These ship with the skill. `../self-skilling/learned/` is where genuinely new, self-authored
heuristics accumulate from real incidents — do not add incident-specific findings here.

## Triangulate before you believe it

A single log line or metric blip is never enough — services are noisy by nature. Before
raising anything, try to see it from at least two of logs/metrics/traces. Logs showing errors
with a flat error-rate metric is often background noise. A metric moving with no corroborating
log lines can mean a boring cause (deploy, load-generator burst, GC pause). If you suspect a
real failure, a trace confirms it reached (or was caused by) a specific request path — stronger
evidence than an aggregate number.

## Check dependencies before blaming the symptom

The service showing visible symptoms (errors, latency) is frequently not where the fault
lives. If a service's own resource signals look normal but its error rate is up, suspect a
downstream dependency. If latency is up but errors are flat, suspect a downstream call is
slow, not the service itself. Pull a trace including that service and look at neighboring
spans — a failing or slow child span outranks the service's own logs as evidence of root
cause. Say what you ruled out, not just what you suspect.

## Severity from user impact, not error-rate magnitude

Two services can show identical error rates and deserve very different severities. Does this
block a core revenue path (checkout, payment, cart) end to end? High severity even at a
modest rate — every failure is a lost transaction. Does it degrade something secondary
(recommendation quality, image load speed)? Lower severity even at a higher rate — the user's
core task still completes. Write the user-impact argument out; a severity label alone isn't
reasoning.

## Correlate with flag changes, but don't stop there

A flag flip in flagd's `/list` near an alert's onset is the closest thing to "a deploy just
happened" in this environment, and a strong causal lead. State it as a hypothesis until
corroborated by log or trace evidence — a flag flip alone is not proof. Absence of a recent
flag change is not proof nothing is wrong either; plenty of real failures (resource exhaustion,
external dependency issues, gradual leaks) have no flag behind them.
