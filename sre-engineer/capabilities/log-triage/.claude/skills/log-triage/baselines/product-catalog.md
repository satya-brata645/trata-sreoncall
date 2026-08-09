---
name: product-catalog
observed_windows: 1
confidence: low
last_revised: 2026-08-09T13:43:00Z
---

## What I have actually seen

Window 1 — 2026-08-09 ~13:23–13:43 UTC, traffic verified live (see below before trusting any
of this):

```
sum by (status_code, span_name)(increase(traces_span_metrics_calls_total{service_name="product-catalog"}[20m]))
  astronomy-db                                  STATUS_CODE_UNSET   4003.2
  oteldemo.ProductCatalogService/GetProduct     STATUS_CODE_UNSET   3295.8
  oteldemo.ProductCatalogService/ListProducts   STATUS_CODE_UNSET    707.4
  -- no STATUS_CODE_ERROR series returned at all
```

```
sum by (service_name)(rate(traces_span_metrics_calls_total[10m]))        -> 6.374 req/s
histogram_quantile(0.95, ... {span_name!="flagd.evaluation.v2.Service/EventStream"}) -> 5.8 ms
curl http://10.10.1.141:4001/list  -> productCatalogFailure defaultVariant "off"
```

Tempo: 40 sampled `oteldemo.ProductCatalogService/GetProduct` traces in 15m, zero carrying
error markers.

Traffic history for the same day, 15m steps —
`increase(traces_span_metrics_calls_total{service_name="product-catalog"}[10m])`:
`0` at every step from 10:04 to 13:04 UTC, then `4028` (13:19), `3824` (13:34).

## What I consider normal, and why

Roughly 6–7 req/s of GetProduct-dominated traffic with a single-digit-millisecond p95 and a
clean status breakdown. The internal `astronomy-db` span outnumbers `GetProduct` (4003 vs
3296) — that's the catalog's own datastore lookup, and I expect it to exceed the RPC count
rather than match it. `ListProducts` runs at roughly a fifth of `GetProduct`.

One window is thin evidence, and this one was taken ~20 minutes after traffic resumed from a
three-hour outage — steady-state numbers could settle differently. Treat the shape (the span
ratios, the near-zero latency, the clean statuses) as more durable than the absolute rates.

## What would make me suspicious

`STATUS_CODE_ERROR` appearing on `GetProduct` at all, especially with gRPC code `Internal`
(13) and the literal message `Error: Product Catalog Fail Feature Flag Enabled` — that exact
string is this service's known fault-injection path (`checkProductFailure` in
`src/product-catalog/main.go`, gating on the `productCatalogFailure` flag), verified in a
prior shift's RCA. It evaluates **per request, keyed on `product_id`**, so it can affect a
fraction of requests rather than all of them; a small error count is not automatically
negligible here.

Also worth a closer look: `astronomy-db` latency climbing while `GetProduct` volume stays flat
(a datastore problem rather than a demand problem), or the `astronomy-db`:`GetProduct` ratio
collapsing toward 1:1 or below, which would suggest caching or an early-return path changed.

## What would NOT

**A drop in errors, on its own, means nothing here.** On 2026-08-09 this service sat at
*exactly zero calls* from 10:04 to 13:04 UTC because the load generator was off — perfectly
clean metrics describing a service nothing was asking anything of. I got this wrong twice
before being corrected for it
(`corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md`). Confirm call
volume is non-zero over the same window before reading anything into an error rate, in either
direction.

Error spans named `flagd.evaluation.v2.Service/EventStream` are not this service's failures —
see `baselines/flagd.md`. They belong to the flag-subscription keepalive and appear across
several services at a constant rate regardless of traffic.

Per-`product_id` coverage is **not** directly checkable on this stack: Tempo tag
`span.app.product.id` returns `{"tagValues":[]}`. So "3,296 calls succeeded" does not strictly
prove every catalog ID is unaffected — high volume through a browse scenario makes it very
likely, but I could not verify it, and I shouldn't pretend otherwise in a future shift either.
