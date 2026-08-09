---
name: triangulate-signals
description: How to tell a real problem from noise by cross-checking logs, metrics, and traces before raising anything.
origin: base
confidence: 0.9
times_applied: 0
---

A single log line or a single metric blip is never enough on its own — services are noisy
by nature, and small samples lie. Before you believe something is wrong, try to see it from
at least two of the three signal types:

- If logs show errors, check whether a metric (error rate, latency) moved in the same window.
  A handful of error lines with a flat error-rate metric is often normal background noise for
  that service, not an incident.
- If a metric looks anomalous, pull the actual log lines behind it. A metric can move for
  boring reasons — a deploy, a load-generator burst, a GC pause — that don't warrant an alert.
- If you suspect a real failure, search for an error trace. A trace confirms the failure
  actually reached (or was caused by) a specific request path, which is much stronger
  evidence than an aggregate number.

If you can only find support in one signal type, treat your hypothesis as unconfirmed and
say so explicitly rather than alerting on a single data point.
