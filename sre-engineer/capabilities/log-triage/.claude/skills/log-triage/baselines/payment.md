---
name: payment
observed_windows: 1
confidence: low
last_revised: 2026-08-09T13:43:00Z
---

## What I have actually seen

Window 1 — 2026-08-09 ~13:23–13:43 UTC, traffic verified live.

```
sum by (service_name, span_name, status_code)(increase(traces_span_metrics_calls_total{span_name=~".*Charge.*"}[20m]))
  payment    oteldemo.PaymentService/Charge    STATUS_CODE_UNSET    87.4
  checkout   oteldemo.PaymentService/Charge    STATUS_CODE_UNSET    87.4
```

```
sum by (service_name)(rate(traces_span_metrics_calls_total[10m]))  -> payment 0.137 req/s
histogram_quantile(0.95, ... excluding EventStream)                -> 1.9 ms
count by (service_name, service_criticality)(...)                  -> payment  critical
curl http://10.10.1.141:4001/list -> paymentFailure "off", paymentUnreachable "off"
```

Its only error signal, and what it actually was:

```
sum by (service_name)(rate(...{status_code="STATUS_CODE_ERROR"}[10m]))  -> payment 0.0019 err/s
sum by (service_name, span_name)(increase(...[30m]))
  payment   flagd.evaluation.v2.Service/EventStream   2.1     <- the entire error signal
```

From trace `5c37f4caf9ad2b7b1c05d252db9c9d34`, payment's spans: `charge` ok, `dns.lookup` ok,
`oteldemo.PaymentService/Charge` ok, `flagd.../ResolveFloat` ok, `tcp.connect` ok, and
`flagd.../EventStream` err×2 with
`"4 DEADLINE_EXCEEDED: Deadline exceeded after 600.000s"`.

## What I consider normal, and why

Low absolute volume — ~0.137 req/s, about 87 charges per 20 minutes — because one charge sits
at the end of a full checkout journey, so payment's rate is roughly 1:1 with checkout's
`PlaceOrder` and two orders of magnitude below frontend's. Sub-2ms p95. Every charge
succeeding is the expected state, and I should read *failed charges* as serious at almost any
rate: this is `service_criticality=critical` and each failure is a lost transaction by
definition.

Its low call volume is exactly what makes its error *rate* misleading — one background error
span per 10 minutes divides into ~82 calls and reads like ~1.4% failure. Judge this service on
the absolute count of failed `Charge` spans, not on a service-level error rate.

## What would make me suspicious

`STATUS_CODE_ERROR` on `oteldemo.PaymentService/Charge` or the internal `charge` span — even a
handful. Severity here comes from what the service does (it takes money at the end of a
completed shopping journey), not from the size of the rate. Two known injectable faults exist:
`paymentFailure` ("Fail payment service charge requests n%", so a *fraction* of charges — a
low error count is not automatically noise) and `paymentUnreachable`. Both read `off` in this
window.

Charge volume decoupling from checkout's `PlaceOrder` volume would also matter — they ran 1:1
here, so a divergence means orders are failing before they reach payment.

## What would NOT

**Payment's service-level error rate, taken at face value.** Its entire error signal in this
window was `flagd.evaluation.v2.Service/EventStream` keepalives aging out at flagd's 600s
server-side timeout (see `baselines/flagd.md`). This is the service I came closest to wrongly
alerting on, and the alert would have been "critical revenue service failing ~1.4% of
requests" while every single charge in fact succeeded.

Payment's EventStream errors *starting* at a particular time is also not a regression: they
first appeared at 13:24 because payment re-subscribed to flagd once traffic returned at ~13:19
after a three-hour load-generator blackout. Before that it had no traffic at all.

Payment is **Node.js and emits no `http_server_*` or `rpc_server_*` metrics** — an empty
result from those families is a metric-family gap, not evidence of health
(`playbooks/lgtm-signal-gotchas.md`). `traces_span_metrics_calls_total` is the family that
actually answers questions about this service.
