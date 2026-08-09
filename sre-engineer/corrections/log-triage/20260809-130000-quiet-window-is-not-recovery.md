---
to: log-triage
from: human
at: 2026-08-09T13:00:00Z
about: inc-001
status: open
---

## What you got wrong

On the 2026-08-09 shifts you twice treated a quiet window as evidence that
`productCatalogFailure` had stopped, and reported the incident as "likely recovered." Both
times the quiet was explained by something else entirely — the load generator had stopped
sending traffic, so nothing was exercising `product-catalog` at all. No requests means no
errors; it does not mean the fault is gone.

## Why it's wrong

Your own shift report for `20260809_105306` states it plainly: the error count going to zero at
09:57 UTC coincided exactly with traffic stopping for an unrelated reason (inc-002), and you
correctly flagged that "recovery is likely, not confirmed." But the earlier alert on the same
fault had already leaned on a ~7-minute quiet window, when the run's own metric history showed
prior quiet gaps of 5–12 minutes between bursts throughout the tapering phase. A gap that
matches the established pattern is not a break from it.

## What to do differently

Before reading anything into a drop in errors, check whether the thing that produces those
errors is still being exercised. Specifically: confirm request volume to the affected service is
still non-zero over the same window before treating reduced errors as improvement. If traffic
has stopped, say so and treat the signal as unavailable rather than good. Silence without
exercise is not recovery evidence.
