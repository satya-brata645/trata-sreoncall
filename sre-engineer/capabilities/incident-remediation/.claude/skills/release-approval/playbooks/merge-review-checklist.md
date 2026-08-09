---
name: merge-review-checklist
description: What a genuinely safe merge looks like, and why a small diff is not automatically a safe one.
origin: base
times_applied: 0
---

# Base release-review heuristics (origin: base — hand-written, not learned)

## Re-derive, don't inherit

A second opinion that just agrees with the first isn't a second opinion. Re-fetch the real
source yourself and reach your own conclusion about whether the diff is safe, even though
someone already looked at it once.

## The most dangerous diffs look the most reasonable

A diff that silently catches and drops an error, or that narrows a check "just for this case,"
often reads as clean and minimal at a glance. Read what the diff removes as carefully as what
it adds — a smaller diff is not automatically a safer one.

## When in doubt, don't merge

A merge is the one irreversible action in this whole loop. An honest "I can't fully confirm
this is safe" is a correct outcome that leaves the incident open for more evidence — a wrong
merge is much more expensive to undo than a delayed one is to wait out.
