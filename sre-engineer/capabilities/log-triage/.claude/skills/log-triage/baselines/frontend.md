---
name: frontend
observed_windows: 1
confidence: low
last_revised: 2026-08-09T13:43:00Z
---

## What I have actually seen

Window 1 — 2026-08-09 ~13:23–13:43 UTC, traffic verified live.

```
sum by (service_name)(rate(traces_span_metrics_calls_total[10m]))  -> frontend 16.219 req/s
histogram_quantile(0.95, ... excluding EventStream)                -> 29.5 ms
count by (service_name, service_criticality)                       -> frontend  critical
```

```
increase(traces_span_metrics_calls_total{service_name="frontend"}[10m]), 15m steps
  ~40 per step throughout 10:04-13:04 UTC (residual, NOT user traffic)
  then 9694 (13:19), 9731 (13:34)
```

No `STATUS_CODE_ERROR` for frontend appeared in either the per-service error sweep
(`rate(...{status_code="STATUS_CODE_ERROR"}[10m])` returned `0.0000`) or the app-wide
error-span-name sweep over 60 minutes.

Span names observed in trace `5c37f4caf9ad2b7b1c05d252db9c9d34`:
`GET /api/products/[productId]/index`, `POST /api/cart`, `POST /api/checkout`,
`executing api route (pages) /api/...`, plus client spans
`oteldemo.ProductCatalogService/GetProduct`, `oteldemo.CartService/AddItem`,
`oteldemo.CartService/GetCart`, `oteldemo.CheckoutService/PlaceOrder`, and
`dns.lookup` / `tcp.connect`.

## What I consider normal, and why

The highest-volume service users actually touch — ~16.2 req/s, roughly 9,700 calls per 15
minutes, sitting just under frontend-proxy's 16.574 because the proxy also fronts flagd-ui and
flagservice. p95 of 29.5ms covers the BFF work plus its downstream calls, so it should track
just below frontend-proxy (32.5ms) and above the leaf services.

Zero errors at this volume is a healthy storefront by any reading. Because frontend is the BFF
for every user journey, its own error spans are a good aggregate signal — but a *lagging* one,
since it fails only when something behind it does.

## What would make me suspicious

Errors on `GET /api/products/[productId]/index`, `POST /api/cart` or `POST /api/checkout` —
those map directly onto browse, cart and buy. Per
`playbooks/investigation-heuristics.md`, when frontend errors rise but its own signals look
fine, read the client spans (`ProductCatalogService/GetProduct`, `CartService/*`,
`CheckoutService/PlaceOrder`) before blaming frontend: in the last known incident
product-catalog's injected fault surfaced here as HTTP 500s across product pages, cart,
recommendations and checkout simultaneously.

A rising p95 with flat errors points at a slow dependency rather than at frontend itself.

## What would NOT

**The ~40 calls per 15 minutes seen during 10:04–13:04 UTC is not user traffic.** It persisted
while product-catalog and checkout sat at *exactly zero*, so it is residual/background
activity. A small non-zero call count is not proof the storefront is being exercised — check
the services behind it (`product-catalog`, `checkout`) before concluding traffic is flowing
(`corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md`).

**frontend ships no logs to Loki at all.** `label/service_name/values` returns only 13 streams
and `frontend`, `frontend-web`, `flagd` and `image-provider` are not among them. A Loki query
for frontend request paths returns zero lines and means *nothing* about frontend's health — I
made exactly this mistake on 2026-08-09 and had to re-derive the question through Tempo.
Use spanmetrics or traces for this service.
