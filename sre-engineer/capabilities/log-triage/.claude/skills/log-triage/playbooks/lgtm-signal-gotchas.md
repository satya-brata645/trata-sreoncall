# LGTM signal gotchas on this specific target app (origin: base — externally sourced)

Ported from PR #4's real, live-tested findings against this exact shared LGTM stack and
target app (not this agent's own experience — cited honestly as someone else's hard-won
findings, not self-authored learning). These are facts about how to correctly *gather and
read* evidence on this system — none of them decide anything on their own; you still have to
reason about what the evidence means. Deliberately excludes PR #4's fleet-correlation logic
(a fixed z-score/share cutoff computing a "widespread vs isolated" verdict in code) — that
crosses into a threshold deciding correlation for you, which is exactly what you must never
accept from a source, your own prior reasoning, or anywhere else. Reach that judgment yourself
from the raw numbers, every time.

## `payment` is Node.js and emits no `http_server_*`/`rpc_server_*` metrics

If you query those metric families for `payment` and get nothing back, that is not evidence
payment is healthy or unmonitored — it's a gap in that metric family for this specific
service. `traces_span_metrics_calls_total` (from the collector's spanmetrics connector) covers
every service regardless of language and should be your first query when a service's RED
metrics come back empty, not your last resort.

## `flagd`'s own `EventStream` spans distort latency percentiles if left in

`flagd`'s `EventStream` spans stay open for the process lifetime, so they sit at roughly 15
seconds and will dominate a p99 latency calculation if included unfiltered. Before concluding
a service has a latency incident from a p99 figure, check whether long-lived streaming spans
(not real request latency) are inflating it — exclude them or check the distribution shape,
not just the single percentile number.

## Resource metrics (CPU/memory) key on `container_name`, not `service_name`

A query for CPU/memory that filters on `service_name` and returns nothing is very likely using
the wrong label for this metric family, not evidence the service has no resource data. Try
`container_name` before concluding a resource metric is unavailable.

## Raw OTLP traces are too large to reason over directly

A single raw trace can run to roughly 100k characters — far past what's useful in one pass of
reasoning. Pull the specific spans relevant to your hypothesis (the error span, its immediate
parent/children) rather than the entire trace tree, and look for the application's own error
message/status within those spans specifically.

## Host-wide drift and a per-service incident look similar until you compare across services

If a metric looks elevated for one service, check the same metric for several *other*,
unrelated services before concluding it's specific to the one you're investigating. A rise
that's happening everywhere at once is more likely infrastructure-wide (a host, a collector, a
noisy-neighbor effect) than a single service's fault — but reach that conclusion by actually
looking at the other services' numbers yourself, not from a precomputed label. If several
services show the same pattern and you haven't checked why, say that explicitly rather than
picking one to blame because it's the one you happened to investigate first.
