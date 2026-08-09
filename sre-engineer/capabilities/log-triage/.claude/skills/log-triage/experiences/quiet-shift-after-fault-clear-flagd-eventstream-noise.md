---
name: quiet-shift-after-fault-clear-flagd-eventstream-noise
description: First fully-clean shift after inc-001/inc-002 cleared; nearly paged on payment and on a checkout "error" trace that were both flagd EventStream 600s timeouts, not user impact
origin: learned
learned_from: outputs/learning_verify_test (2026-08-09 ~13:33-13:45 UTC)
evidence_refs:
  - 'sum by (span_name)(increase(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[60m])) -> EventStream 21.3, flagSync 1.0, total 22.4 app-wide'
  - 'trace 5c37f4caf9ad2b7b1c05d252db9c9d34 (load-generator user_checkout_single) -- only error spans are flagd EventStream "4 DEADLINE_EXCEEDED ... after 600.000s" and flagd "stream closed due to server-side timeout"; PlaceOrder/Charge/GetProduct/AddItem/Convert/ship-order/send_order_confirmation all ok'
  - 'sum by (status_code, span_name)(increase(...{service_name="product-catalog"}[20m])) -> GetProduct 3295.8 STATUS_CODE_UNSET, zero error series'
  - 'increase(...{service_name=~"frontend|product-catalog|cart|checkout"}[10m]) 15m steps -> product-catalog and checkout 0 calls 10:04-13:04 UTC, then 4028/638 at 13:19'
  - 'curl http://10.10.1.141:4001/list -> all 13 fault-injection flags off, loadGeneratorTraffic on'
  - 'sum(increase(...{service_name="frontend-proxy",status_code="STATUS_CODE_ERROR"}[15m])) 3h -> 0.0 at all 13 buckets'
times_applied: 0
---

Zero alerts, and that was the right answer. Both incidents the previous shift left open had
cleared: every fault-injection flag read `off`, `loadGeneratorTraffic` was back `on`, and
traffic resumed between 13:04 and 13:19 UTC after a three-hour blackout.

**The thing worth remembering is what I nearly paged on.**

Four services — payment, ad, recommendation, flagd — showed an identical non-zero error rate
of 0.0019/s. Payment is `service_criticality=critical` and its call volume is low (0.137
req/s), so that rate reads like ~1.4% failure on the revenue path. Separately, Tempo returned
exactly one error trace in 25 minutes, rooted at `load-generator user_checkout_single` — a
checkout journey.

Both were the same thing, and neither was real. flagd closes each `EventStream` flag
subscription server-side at 600 seconds. Subscribers log
`4 DEADLINE_EXCEEDED: Deadline exceeded after 600.000s`; flagd's own side says
`stream closed due to server-side timeout`. One error span per subscriber per 10 minutes,
forever. In the checkout trace, every business span succeeded — the order was charged,
shipped and confirmed by email; the trace was flagged `error` purely because a background
keepalive timed out inside its window.

Three things actually did the work, and I'd want all three next time:

1. **The error rate didn't move when traffic did.** recommendation and ad held exactly
   1.1 errors/10m straight through three hours of *zero* user traffic. An error stream that
   ignores request volume isn't produced by user requests. That single observation ruled out a
   user-facing fault before I had any idea what the spans were.
2. **Four unrelated services at an identical rate is a shared mechanism, not four faults.**
   That's what stopped me opening a payment alert on the spot.
3. **Pulling the actual spans beat trusting the trace's error flag.** Judging that trace by
   its status would have produced a critical false page on checkout.

The correction I'd been given
(`corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md`) mattered more than
I expected. It's phrased as a guard against false *good* news, and it worked that way — the
storefront sat at exactly zero calls from 10:04 to 13:04 UTC, so a sweep 30 minutes earlier
would have shown a beautifully clean system that meant nothing. But it also gave me the thing
the previous shift couldn't get: once traffic was verifiably live, product-catalog's 3,295.8
GetProduct calls with zero errors became real evidence about inc-001, not another quiet window.
That is the same check paying off in both directions, which is why I've written the
volume-before-verdict rule into every baseline I wrote today rather than just remembering it.

Two honest gaps I hit and could not close:

- `frontend`, `frontend-web`, `flagd` and `image-provider` ship **no logs to Loki at all**
  (only 13 streams exist). My Loki query for frontend request paths returned zero lines and
  that meant nothing about frontend's health.
- spanmetrics here carries **no `http_response_status_code` label** — only span-level
  `status_code`. My 5xx query returned one `(none)` bucket and, again, meant nothing.
- Tempo tag `span.app.product.id` returns `{"tagValues":[]}`, so I could not confirm the
  recovered catalog was exercised across all 10 product IDs. High volume makes full coverage
  likely; likely is not verified, and I said so rather than rounding it up.

What I'd tell myself: an empty result from a wrong query is indistinguishable from an empty
result meaning "nothing is wrong". Find out which one you have before you write it down.

**Playbook candidate, identified but deliberately not written this shift:** *"When a service
shows a low, suspiciously constant error rate, check whether the error signal tracks request
volume before treating it as user-facing."* I searched first — `lgtm-signal-gotchas.md` covers
flagd EventStream spans distorting *latency percentiles* but says nothing about them
distorting *error counts*, and the covariance test appears nowhere else in `playbooks/` or
`experiences/`. It's detection technique, so it's mine to own. Not written because the playbook
bar requires a fresh blind refuter sub-agent and this session was directed not to spawn one;
recording a verdict I never obtained would leave a file that looks vetted and isn't. Preserved
here verbatim so the next shift that can run the refuter promotes it in minutes.
