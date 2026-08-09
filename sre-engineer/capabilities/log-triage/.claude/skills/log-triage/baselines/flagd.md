---
name: flagd
observed_windows: 1
confidence: medium
last_revised: 2026-08-09T13:43:00Z
---

## What I have actually seen

Window 1 — 2026-08-09 ~13:33–13:43 UTC.

```
sum by (service_name)(rate(traces_span_metrics_calls_total[10m]))  -> flagd 11.500 req/s
histogram_quantile(0.95, ... {span_name!="flagd.evaluation.v2.Service/EventStream"}) -> 1.9 ms
```

The whole application's error budget, for a full hour:

```
sum by (span_name)(increase(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[60m]))
  flagd.evaluation.v2.Service/EventStream   21.3
  flagSync                                   1.0
  -- TOTAL app-wide error spans in 60 minutes: 22.4, both names flagd-internal
```

The mechanism, quoted verbatim from the two sides of the same stream in trace
`5c37f4caf9ad2b7b1c05d252db9c9d34`:

```
payment span:  "4 DEADLINE_EXCEEDED: Deadline exceeded after 600.000s,
                metadata filters: 0.001s,remote_addr=172.18.0.4:8013"   rpc.grpc.status_code=4
flagd span:    "stream closed due to server-side timeout"               rpc.grpc.status_code=4
```

Per-subscriber error cadence, `increase(...{status_code="STATUS_CODE_ERROR"}[10m])` stepped
across 3h: recommendation `1.1` at **every** bucket 10:34→13:34; ad `1.1` per bucket with a
gap 12:24–13:14; flagd itself `1.1`–`3.3`; payment `1.1` but only from 13:24 onward.

## What I consider normal, and why

flagd is this stack's dominant — and on a healthy day, its *only* — source of error spans.
Each subscribing service holds one `EventStream` flag subscription, flagd closes it
server-side at 600 seconds, the client reports `DEADLINE_EXCEEDED`, and it reconnects. That
600s period exactly predicts the one-error-per-subscriber-per-10-minutes cadence I measured,
and it accounted for 21.3 of 22.4 app-wide error spans in an hour. `flagSync` contributes
roughly one more per hour.

~11.5 req/s of flag evaluations with a ~2ms p95 is the serving side, and that is genuinely
healthy. Note the p95 is only meaningful *because* I excluded the EventStream span — see
below.

Payment's errors appearing only from 13:24 is not payment degrading; it re-subscribed once
traffic resumed at ~13:19 after the load-generator blackout.

## What would make me suspicious

Flag *evaluation* spans failing — `ResolveFloat`, `ResolveBoolean`, `resolveFloat` and the
like carrying `STATUS_CODE_ERROR`, rather than `EventStream`/`flagSync`. Those are on the
request path: services evaluate flags synchronously while serving users, so a real flagd
serving failure would surface there and would plausibly affect every service at once.

A change in the EventStream *cadence* would also be worth understanding — much more than one
error per subscriber per 10 minutes suggests the streams are dropping early rather than aging
out at their timeout.

## What would NOT

**`EventStream` errors themselves, in any quantity that matches the 600s cadence.** They are a
keepalive aging out, not a user-visible failure. On 2026-08-09 they nearly cost me two false
pages: payment (`service_criticality=critical`, 0.137 req/s) showed 0.0019 err/s, which reads
as ~1.4% failure on the revenue path, and Tempo surfaced a `user_checkout_single` trace flagged
`error`. In that trace **every** business span succeeded — PlaceOrder, Charge, GetProduct,
AddItem, Convert, ship-order, send_order_confirmation — and the order completed end to end.

The clean tell: these errors **do not track request volume**. recommendation and ad held a
constant 1.1/10m through three hours of *zero* user traffic. Anything summing error spans
per service without that check will carry a permanent phantom fault on every flagd subscriber.

`EventStream` also wrecks latency percentiles — a ~600s span will dominate any p99, and the
existing `playbooks/lgtm-signal-gotchas.md` warns about this (it observed ~15s spans; I
measured 600s here). Exclude `span_name!="flagd.evaluation.v2.Service/EventStream"` before
reading any latency figure.

flagd ships **no logs to Loki** on this stack (only 13 `service_name` streams exist, and flagd
is not among them). An empty Loki result for flagd is a coverage gap, not evidence of health.
