---
name: cart
observed_windows: 1
confidence: low
last_revised: 2026-08-09T13:43:00Z
---

## What I have actually seen

Window 1 — 2026-08-09 ~13:23–13:43 UTC, traffic verified live.

```
sum by (service_name, span_name, status_code)(increase(traces_span_metrics_calls_total{span_name=~".*(AddItem|GetCart).*"}[20m]))
  cart       POST /oteldemo.CartService/AddItem    STATUS_CODE_UNSET    317.9
  cart       POST /oteldemo.CartService/GetCart    STATUS_CODE_UNSET    986.3
  frontend   oteldemo.CartService/AddItem          STATUS_CODE_UNSET    316.8
  frontend   oteldemo.CartService/GetCart          STATUS_CODE_UNSET    892.6
  checkout   oteldemo.CartService/GetCart          STATUS_CODE_UNSET     87.4
```

```
sum by (service_name)(rate(traces_span_metrics_calls_total[10m]))  -> cart 2.865 req/s
histogram_quantile(0.95, ... excluding EventStream)                -> 1.9 ms
count by (service_name, service_criticality)                       -> cart  high
curl http://10.10.1.141:4001/list -> cartFailure "off", failedReadinessProbe "off"
```

Traffic history, 15m steps: `~40` per step through 10:04–13:04 UTC, then `1909` (13:19),
`1718` (13:34). From trace `5c37f4caf9ad2b7b1c05d252db9c9d34`, cart's backing store appears as
7 `valkey-cart:6379` spans, all ok.

## What I consider normal, and why

~2.9 req/s, read-heavy: `GetCart` outnumbers `AddItem` roughly 3:1 (986.3 vs 317.9), which
makes sense since every page view and the checkout flow read the cart while only an explicit
add writes it. Server-side counts match the callers' client-side counts closely (cart's
`AddItem` 317.9 vs frontend's 316.8; `GetCart` 986.3 vs frontend 892.6 + checkout 87.4 = 980.0)
— that near-agreement is itself a health signal, since a large gap would mean calls dying in
transit. Sub-2ms p95, backed by valkey.

## What would make me suspicious

`STATUS_CODE_ERROR` on `AddItem` or `GetCart`. This service has two known injectable faults:
`cartFailure` ("Fail cart service n% of the time" — a *fraction*, so a modest error count is
not automatically noise) and `failedReadinessProbe`. Both read `off` in this window, but the
previous shift (2026-08-09, run `20260809_105306`) recorded `cartFailure` live-deviating to
`on` without any incident ever being declared on it, so this flag has a history of being
flipped here.

A widening gap between server-side and client-side call counts, or `valkey-cart:6379` spans
erroring or slowing, would both be worth pulling on — the second would be a datastore problem
rather than a cart problem.

## What would NOT

**The ~40 calls per 15 minutes seen during the 10:04–13:04 UTC blackout is not user traffic**,
and the zero errors alongside it meant nothing. Confirm volume before reading a clean cart as
health (`corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md`).

`GetCart` massively outnumbering `AddItem` is normal read-heavy behaviour, not a conversion
problem — don't read the ratio as users failing to add items.
