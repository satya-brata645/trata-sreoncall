# log-triage — baseline evaluation, shift `learning_verify_test`

Swept 2026-08-09 ~13:33–13:43 UTC. **18 services observed. Zero alerts raised.**

## The honest headline

Every service I swept is healthy, and I have positive proof of function (completed orders,
successful charges, served product pages) rather than merely an absence of complaints.

**Every baseline below is a first write.** `baselines/` contained only `FORMAT.md` when this
shift started, so for each service the comparison was against *nothing*. That is the weakest
version of this check there is, and I would rather say so than imply a comparison I couldn't
make. Where I could compare against something real — the two open incidents recorded by the
previous shift — I did, and I've said so explicitly.

## Correction applied — `corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md`

Applied, not disputed. It told me I had twice read falling errors as improvement when the
real explanation was that the load generator had stopped and nothing was exercising the
service. The instruction: confirm request volume is non-zero over the same window before
reading anything into reduced errors.

This shift that check changed what I was allowed to conclude, and it very nearly changed my
conclusion. The storefront was genuinely dark for three hours:

```
increase(traces_span_metrics_calls_total{service_name=~"frontend|product-catalog|cart|checkout"}[10m]), 15m steps
product-catalog  10:04→13:04 = 0 calls at EVERY step, then 4028 (13:19), 3824 (13:34)
checkout         10:04→13:04 = 0 calls at EVERY step, then  638 (13:19),  500 (13:34)
frontend         ~40/15m through the dead period,        then 9694 (13:19), 9731 (13:34)
```

Traffic resumed between 13:04 and 13:19 UTC. **So every recovery claim below rests only on the
post-13:19 window** — before that, zero errors meant zero requests, exactly the trap I was
corrected for. Had I swept 30 minutes earlier I would have seen a perfectly clean system and
it would have meant nothing at all.

---

## Per-service

### product-catalog — **no baseline yet → written. Healthy, and materially recovered.**

```
sum by (status_code, span_name)(increase(...{service_name="product-catalog"}[20m]))
  astronomy-db                                  STATUS_CODE_UNSET   4003.2
  oteldemo.ProductCatalogService/GetProduct     STATUS_CODE_UNSET   3295.8
  oteldemo.ProductCatalogService/ListProducts   STATUS_CODE_UNSET    707.4
  (no STATUS_CODE_ERROR series returned at all)
p95 5.8ms · 6.374 req/s · flagd: productCatalogFailure = off
```

This is the measurement the previous shift was structurally unable to take. `inc-001`'s open
question was whether `productCatalogFailure` had actually cleared, and it was unanswerable
then because traffic was dark — the only evidence available was a *single* manual probe.
**3,295.8 real GetProduct calls in 20 minutes with zero errors, against verified live
traffic**, is evidence backed by exercise.

Residual gap, stated rather than rounded away: the original fault evaluated per-request
against a `product_id`, so coverage matters. I tried to confirm all 10 catalog IDs were hit —
Tempo tag `span.app.product.id` returned `{"tagValues":[]}`, so that attribute isn't queryable
here and **I could not verify per-ID coverage directly.** 3,296 calls through a browse
scenario that selects across the catalog makes full coverage very likely, but likely is not
verified. `alert-grouping` owns the resolution decision; I'm handing over the measurement, not
a verdict.

### frontend-proxy — **no baseline yet → written. Healthy.**
```
sum(increase(...{service_name="frontend-proxy",status_code="STATUS_CODE_ERROR"}[15m])), 3h
  10:37→13:37: 0.0 at all 13 buckets
16.574 req/s · p95 32.5ms · service_criticality=critical
```
The edge is the least ambiguous proxy for user-visible failure — anything reaching a user as a
5xx crosses here. Three unbroken hours at zero is the single strongest piece of evidence
behind raising nothing.

### frontend — **no baseline yet → written. Healthy.**
16.219 req/s, 9694 then 9731 calls/15m, p95 29.5ms, zero error spans. Highest-volume
user-facing service.

### checkout — **no baseline yet → written. Healthy.**
`PlaceOrder 87.4/20m, all STATUS_CODE_UNSET`, p95 27.8ms, zero errors. 87 orders placed and
none failed. Its flat zero from 10:04–13:04 was the blackout, not a fault of its own.

### payment — **no baseline yet → written. Healthy. The one I nearly got wrong.**
```
oteldemo.PaymentService/Charge   87.4/20m   STATUS_CODE_UNSET   (0 errors)
but: rate(...{status_code="STATUS_CODE_ERROR"}[10m]) = 0.0019 err/s
```
Against payment's low call volume that error rate looks like ~1.4% failure on a **critical
revenue service** — the most alarming-looking number of the shift. It is entirely
`flagd.evaluation.v2.Service/EventStream` keepalives, and **every actual Charge succeeded**.
Payment's error signal only appears from 13:24 because it re-subscribed to flagd once traffic
returned. Per `lgtm-signal-gotchas`, payment is Node.js and emits no `http_server_*`/
`rpc_server_*` at all, so spanmetrics was the only family that could answer this.

### cart — **no baseline yet → written. Healthy.**
`AddItem 317.9`, `GetCart 986.3` per 20m, all UNSET, p95 1.9ms. `cartFailure` now `off` — the
previous shift recorded it deviating to `on` with no incident ever declared; that loose end is
now closed by evidence.

### recommendation, ad — **no baseline yet. Healthy; error signal is not theirs.**
recommendation 1.374 req/s p95 4.2ms; ad 0.570 req/s p95 2.0ms. Both carry a constant
1.1 errors/10m that is entirely flagd EventStream — and it **persisted unchanged through three
hours of zero user traffic**. An error stream that doesn't move when traffic goes to zero and
doesn't move when it returns is not produced by user requests. Any detection that summed error
spans per service would have carried a permanent phantom fault on both, forever.
`recommendationCacheFailure` now `off` (previous shift recorded it deviating to `on`).

### flagd — **no baseline yet → written. Healthy, behaving as designed. This stack's noise source.**
```
sum by (span_name)(increase(...{status_code="STATUS_CODE_ERROR"}[60m]))  — APP-WIDE
  flagd.evaluation.v2.Service/EventStream   21.3
  flagSync                                   1.0
  TOTAL error spans, entire application, 60 minutes: 22.4 — both names flagd-internal
```
Mechanism, quoted verbatim from the system itself: flagd closes each subscription server-side
at 600s (`"stream closed due to server-side timeout"`), and subscribers report
`"4 DEADLINE_EXCEEDED: Deadline exceeded after 600.000s"`. 600s exactly predicts the observed
1-per-10-minute cadence per subscriber, its persistence through the blackout, and payment's
13:24 appearance. 11.5 req/s, p95 1.9ms measured *excluding* those spans.

### otelcol-contrib (my own observability pipeline) — **degraded, narrowly and knowingly.**
`"Error scraping metrics"`, `scraper="process"`, at 1 per 10m (13:10, 13:30). It is the
hostmetrics **process** scraper hitting container permissions — *not* the app telemetry path.
Verified rather than assumed: traces, spanmetrics and logs from every service are all flowing,
because I queried all three this shift. I evaluate my own instrumentation as a service because
if it fails I stop being able to see anything else. Not an alert; recorded, not waved away.

### Swept, no material finding, no baseline written
currency 0.672 · quote 0.350 · shipping 0.300 · email 0.267 · image-provider 2.106 ·
frontend-web 6.815 (p95 49.1ms) · telemetry-docs 0.198 · load-generator 2.167 · flagd-ui 0.000

Named so the sweep is auditable. `flagd-ui` at zero is an idle admin UI with no user journey
depending on it, not an outage. `load-generator`'s p95 of 2344ms is its own simulated user
journey including think-time, not a service responding slowly. I'm not writing baselines for
these — one low-information window each would be padding, and this is a log, not a performance.

---

## What I nearly alerted on, and why I didn't

**1. payment, a critical revenue service at ~1.4% error rate.** Real number. Entirely
flag-subscription keepalives; all 87 charges succeeded.

**2. A checkout error trace.** Tempo returned exactly one error trace in 25 minutes:
`5c37f4caf9ad2b7b1c05d252db9c9d34`, root `load-generator user_checkout_single`. I pulled its
spans rather than judging it by its error flag:

```
ERROR spans:   payment  flagd.../EventStream  "4 DEADLINE_EXCEEDED ... after 600.000s"
               flagd    flagd.../EventStream  "stream closed due to server-side timeout"
SAME TRACE:    checkout PlaceOrder ok · payment Charge ok · checkout GetProduct ok
               cart AddItem/GetCart/EmptyCart ok · currency Convert ok ×2
               shipping ship-order ok · email send_order_confirmation ok
               → 0 errors among every business span
```

The order completed end to end: charged, shipped, confirmation emailed. The trace is flagged
`error` purely because a background flag-subscription stream hit its 600s timeout inside the
trace's window. Paging on this would have been a critical false alarm on the revenue path.

Both would have been false pages, and a false page costs a human their night.

## Two empty results I refused to score as evidence

An empty result from a wrong query looks identical to an empty result meaning "nothing is
wrong". Treating the first as the second is how you certify a system healthy without having
examined it.

- Loki query for frontend request paths returned **0 lines**. Cause: `label/service_name/values`
  shows Loki carries only 13 streams — **`frontend`, `frontend-web`, `flagd` and
  `image-provider` ship no logs to Loki at all.** Not a frontend problem; a coverage gap.
- frontend-proxy HTTP 5xx query returned one `(none)` bucket of 30299. Cause: `/api/v1/series`
  shows spanmetrics here carries **no `http_response_status_code` label**; the only status
  label is span-level `status_code`.

Both were my query defects. I re-derived both questions through Tempo and span status instead,
and recorded the gaps so a future shift doesn't re-learn them the hard way.

## Verdict

**Zero alerts.** All 13 fault-injection flags read `off`; every error span in the application
over 60 minutes is flagd-internal; the edge has been clean for 3 hours; the revenue path
completed 87 orders and 88 charges in 20 minutes with no failures. Raising nothing is the
correct answer and I'll state it plainly rather than manufacture a finding to look busy.

Handoff to `alert-grouping`: both prior incidents now have real exercised evidence bearing on
them — `inc-001` (product-catalog clean across 3,295.8 calls, `productCatalogFailure` off) and
`inc-002` (`loadGeneratorTraffic` back `on`, traffic restored 13:19). Those resolution
decisions are its call, not mine.
