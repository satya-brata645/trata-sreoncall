---
name: correlate-with-flag-changes
description: A recent feature-flag change near the same time as a symptom is a strong causal lead — check it before any other hypothesis.
origin: base
confidence: 0.8
times_applied: 0
---

This environment's changes are exposed as feature-flag flips, the closest thing available
here to "a deploy just happened." Before reasoning about subtler causes (load, cache
warmth, downstream slowness), check whether any flag changed state in the minutes just
before the symptom appeared.

- A flag flip within the last few minutes of a symptom's onset is strong circumstantial
  evidence of causation, even though it isn't proof — say so as a hypothesis, not a
  certainty, until you've also found supporting log or trace evidence.
- The flag's own name and description often tell you exactly which service and failure mode
  to expect — use that to target your log and trace queries instead of searching blindly.
- If no flag changed recently, say so explicitly rather than silently skipping this check —
  ruling it out is itself useful evidence for whoever reads the alert later.

Never treat the absence of a flag change as proof nothing is wrong — plenty of real failures
(resource exhaustion, external dependency issues, gradual leaks) have no flag behind them.
