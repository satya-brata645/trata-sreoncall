---
name: when-the-cause-is-live-state-not-code
description: How to tell whether an incident has any legitimate code fix at all, when the real cause is a runtime flag or environment value rather than a defect in the source.
origin: learned
learned_from: inc-001 (productCatalogFailure)
evidence_refs: [src/product-catalog/main.go GetProduct/checkProductFailure, src/product-catalog/flags.json defaultVariant=off, flagd /status publishing only defaultVariant]
times_applied: 0
---

Externally sourced: this reasoning came from a parallel run of this same capability on
another branch (PR #17, `feature/sre-oncall-updates`), which reached `deferred` on the same
incident this capability fixed differently. Preserved here because the argument is worth
keeping regardless of which outcome shipped — it is the clearest articulation this project has
of when deferral is the *correct* answer rather than a failure to try.

## The situation

`product-catalog` was returning `codes.Internal` on `GetProduct` for a subset of requests. RCA
verified the mechanism against real source: `checkProductFailure` evaluates the flagd boolean
`productCatalogFailure`, and when it's on, `GetProduct` returns before reaching the DB. The
code was doing exactly what it was written to do.

## The trap, and how to see it

The cause of the *failure* was the flag's live variant being flipped on — not a defect in the
Go code that reads it. That reframes what a fix would even mean, and three tempting options
all fail on inspection:

- **Removing or bypassing the `checkProductFailure` gate** — this is deleting an upstream
  project's deliberate fault-injection feature so my own alert goes quiet. That is hiding the
  symptom, and it's the exact move the "fix the cause, don't hide the symptom" rule exists to
  stop. The cause is not the function's existence.
- **Editing the flag manifest's default** (`flags.json`, `demo.flagd.json`) — the default was
  already `off`. The flag was firing because the *live* variant had been overridden at
  runtime. Rewriting a default that is already correct does not override a runtime override;
  the proposal would be theatre.
- **Calling flagd's `/toggle` to set it back** — the one action that would actually resolve
  it, and prohibited project-wide. That rule isn't an obstacle to route around; the
  fault-injection state belongs to whoever is running the scenario, not to this agent, and on
  shared infrastructure other teams may be mid-experiment.

## What to take from this

When the verified cause is live/runtime state rather than versioned code, check whether *any*
permitted action actually addresses it before reaching for a diff. If none does, `deferred`
with a clear hand-off is the honest outcome — and specifically say what it is *not*: not
"couldn't reproduce" (the trace signature matched verbatim), not "couldn't find the code" (file,
function and error string all cited), not "the second opinion rejected my diff" (there was no
diff worth reviewing).

## The counter-case, on the same incident

This capability's other run reached a different, also-defensible answer: it left the
fault-injection mechanism untouched but noticed that the *error classification* was
independently wrong — `codes.Internal` where gRPC's own spec documents `codes.Unavailable` for
a deliberately transient condition — and fixed that instead, while stating plainly that doing
so does not reduce the incident's blast radius.

Both readings share the same discipline: neither touched the fault injection, and neither
pretended to have solved the outage. The distinction worth remembering is that "there is no
legitimate fix for the incident's cause" and "there is nothing legitimately wrong nearby" are
different claims — and the second one deserves a look before defaulting to deferral. Whichever
way it lands, say which of the two you concluded and why.
