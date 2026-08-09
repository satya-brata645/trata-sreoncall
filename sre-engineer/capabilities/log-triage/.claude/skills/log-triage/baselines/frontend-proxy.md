---
name: frontend-proxy
observed_windows: 1
confidence: low
last_revised: 2026-08-09T13:43:00Z
---

## What I have actually seen

Window 1 — 2026-08-09, error history swept across a full 3 hours.

```
sum(increase(traces_span_metrics_calls_total{service_name="frontend-proxy",status_code="STATUS_CODE_ERROR"}[15m]))
  10:37 0.0 · 10:52 0.0 · 11:07 0.0 · 11:22 0.0 · 11:37 0.0 · 11:52 0.0 · 12:07 0.0
  12:22 0.0 · 12:37 0.0 · 12:52 0.0 · 13:07 0.0 · 13:22 0.0 · 13:37 0.0
```

```
sum by (service_name)(rate(traces_span_metrics_calls_total[10m]))  -> 16.574 req/s (highest of any service)
histogram_quantile(0.95, ... excluding EventStream)                -> 32.5 ms
count by (service_name, service_criticality)                       -> frontend-proxy  critical
```

Span names seen (via `/api/v1/series`): `router frontend egress`, `router flagd-ui egress`,
`router flagservice egress`, plus `GET`/`POST`. `telemetry_sdk_name=envoy`,
`service_version=3.0.0`.

## What I consider normal, and why

This is the edge — every user request enters here, so its call rate is the highest in the
stack (16.574 req/s, marginally above frontend's 16.219 because it also fronts flagd-ui and
flagservice routes). p95 of 32.5ms is the whole round trip including everything downstream,
which is why it sits just above frontend's own 29.5ms rather than below it.

**Zero errors is what healthy looks like here, and it's the most valuable single number I
have.** Anything that reaches a real user as a 5xx has to cross this hop, so a clean edge over
a long window is the closest thing on this stack to direct evidence of no user-visible
failure. Three continuous hours at zero was the strongest evidence behind raising no alert on
2026-08-09.

## What would make me suspicious

Any sustained non-zero `STATUS_CODE_ERROR`, particularly on `router frontend egress` — that is
the storefront path, and errors there mean users are being served failures rather than pages.
Because the edge aggregates everything, errors appearing here while individual backends look
clean would point at the proxy or its routing rather than at any one service.

A p95 climbing well above ~32ms while backend p95s stay flat would suggest the proxy or the
network in front of it, not the application.

## What would NOT

**A drop to zero traffic is not a healthy edge.** During 10:04–13:04 UTC on 2026-08-09 the
load generator was off; the storefront served essentially nothing and this hop was trivially
error-free. Confirm call volume is non-zero before reading anything into a clean edge
(`corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md`).

**There is no HTTP status code label on this stack.** `/api/v1/series` for
`traces_span_metrics_calls_total{service_name="frontend-proxy"}` returns only span-level
`status_code` — no `http_response_status_code`. A `sum by (http_response_status_code)` query
returns one `(none)` bucket containing everything (I measured `30299.0`), which looks like a
result and answers nothing. Use span `status_code`, or Tempo, to ask about failures here.
