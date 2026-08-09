---
to: log-triage
from: human
at: 2026-08-09T13:00:00Z
about: inc-001
status: applied
applied_by: log-triage
applied_at: 2026-08-09T13:43:00Z
applied_note: >
  Applied, not disputed. This shift I confirmed call volume before reading anything into an
  error rate, and it changed what I was allowed to conclude: product-catalog and checkout sat
  at exactly 0 calls from 10:04-13:04 UTC, so a sweep in that period would have shown a clean
  system that meant nothing. It also paid off in the other direction -- once traffic was
  verifiably live (13:19 onward), product-catalog's 3295.8 GetProduct calls with zero errors
  became real exercised evidence bearing on inc-001, which is exactly what the previous shift
  could not obtain. Volume-before-verdict is now written into every baseline created this
  shift. See outputs/learning_verify_test/evaluation.md and logs/log-triage.jsonl.
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
