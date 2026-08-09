---
name: checkout
observed_windows: 1
confidence: low
last_revised: 2026-08-09T13:43:00Z
---

## What I have actually seen

Window 1 — 2026-08-09 ~13:23–13:43 UTC, traffic verified live.

```
sum by (service_name, span_name, status_code)(increase(traces_span_metrics_calls_total{span_name=~".*(PlaceOrder|Charge|GetCart).*"}[20m]))
  checkout   oteldemo.CheckoutService/PlaceOrder     STATUS_CODE_UNSET   87.4
  frontend   oteldemo.CheckoutService/PlaceOrder     STATUS_CODE_UNSET   87.4
  checkout   oteldemo.PaymentService/Charge          STATUS_CODE_UNSET   87.4
  checkout   oteldemo.CartService/GetCart            STATUS_CODE_UNSET   87.4
```

```
sum by (service_name)(rate(traces_span_metrics_calls_total[10m]))  -> 0.833 req/s
histogram_quantile(0.95, ... excluding EventStream)                -> 27.8 ms
count by (service_name, service_criticality)                       -> checkout  critical
```

Its full fan-out, from trace `5c37f4caf9ad2b7b1c05d252db9c9d34` (one complete order, all ok):
`PlaceOrder` → `prepareOrderItemsAndShippingQuoteFromCart`, `CartService/GetCart`,
`ProductCatalogService/GetProduct`, `CurrencyService/Convert` ×2, `PaymentService/Charge`,
`CartService/EmptyCart`, and downstream `shipping POST /ship-order` +
`email POST /send_order_confirmation`.

Traffic history, 15m steps: `0` calls at every step 10:04→13:04 UTC, then `638` (13:19),
`500` (13:34).

## What I consider normal, and why

Low rate, high value: ~0.833 req/s, about 87 orders per 20 minutes. `PlaceOrder`, `GetCart`
and `Charge` all ran at exactly 87.4 — a clean 1:1:1, which is the shape I'd expect since each
order consults the cart once and charges once. p95 of 27.8ms is high relative to leaf services
(cart 1.9ms, payment 1.9ms) precisely because this span *contains* all of them; that is
fan-out, not slowness.

Every order completing is the expected state. This is `service_criticality=critical` and each
failure is a lost transaction, so severity here comes from what a failure costs a user, not
from the size of an error rate.

## What would make me suspicious

Any `STATUS_CODE_ERROR` on `PlaceOrder`. Also a break in the 1:1:1 ratio — `PlaceOrder`
holding steady while `Charge` falls off means orders are dying before payment; `GetCart`
outpacing `PlaceOrder` means carts are being read but not converted.

Because checkout fans out to six services, it is the first place a downstream fault becomes
visible as user-facing failure. Per `playbooks/investigation-heuristics.md`, if checkout errors
rise while its own signals look fine, suspect a dependency and read the neighbouring spans
before blaming checkout itself — in the last known incident, product-catalog's injected fault
surfaced here as failed checkouts.

## What would NOT

**Zero calls is not zero problems.** This service sat at *exactly zero* from 10:04 to 13:04
UTC on 2026-08-09 because the load generator was off — no orders, no errors, and nothing
learned. Confirm volume before reading a clean checkout as good news
(`corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md`).

**A Tempo trace flagged `error` and rooted at `user_checkout_single` is not automatically a
failed order.** On 2026-08-09 the single error trace in a 25-minute window was flagged solely
because a background `flagd.evaluation.v2.Service/EventStream` keepalive timed out at 600s
inside the trace's window; every business span succeeded and the order was charged, shipped
and confirmed by email. Pull the actual spans before believing a trace's status
(see `baselines/flagd.md`).
