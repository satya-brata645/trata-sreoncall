---
name: severity-from-user-impact
description: How to reason about severity from what the service does for the user, not from the size of an error-rate number.
origin: base
confidence: 0.9
times_applied: 0
---

Two services can show identical error-rate numbers and deserve very different severities.
Reason about severity from what a user is actually prevented from doing, not from the
magnitude of a metric:

- Does this block a core revenue path (checkout, payment, cart) end to end? That argues for
  high severity even at a modest error rate, because every failure is a lost transaction.
- Does this degrade something cosmetic or secondary (recommendation quality, image load
  speed, an ad slot)? That argues for lower severity even at a higher error rate, because
  the user's core task still completes.
- Is the failure total (service unreachable) or partial (n% of requests)? Total failure on
  a secondary path can still outrank partial failure on a core path — reason about it, don't
  default to "core path always wins."

Always write out the user-impact argument in `severity_reasoning` rather than stating a
severity level alone. If you can't articulate the impact, you probably don't understand the
fault well enough to have raised it yet.
