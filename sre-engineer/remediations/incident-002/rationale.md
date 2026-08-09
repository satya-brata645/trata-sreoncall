# Remediation rationale — incident-002

## Type: config_proposal (not code_fix)

The verified RCA (`rca.verified == true`, confidence 0.85) explicitly found no code defect:
`implicated_file` and `implicated_function` are both `null`. `src/load-generator/script.js`'s
`httpScenario()`/`browserScenario()` guard on `getFlagdValue('loadGeneratorTraffic') <= 0` and
skip traffic generation by design — that is correct behavior, not a bug. The actual fault is
that this sandbox's live flagd instance currently evaluates `loadGeneratorTraffic` to `off`,
deviating from the value shipped and versioned upstream in
`open-telemetry/opentelemetry-demo`'s `src/flagd/demo.flagd.json` (`defaultVariant: "on"`,
`variants {off:0, on:1}`). There is no code to patch; the mismatch lives entirely in this
environment's live runtime flag state, which this project's rules forbid any capability from
writing to directly (`/toggle` is off-limits, always).

## Proposed change

Apply a **scoped** OFREP/admin update setting `loadGeneratorTraffic` specifically back to `on`
in this environment's live flagd instance — restoring it to the value already shipped upstream.

**Explicitly do NOT** restart or reload the entire flagd instance from the shipped
`demo.flagd.json` wholesale. Live `/list` at 11:35 UTC also showed `cartFailure` and
`recommendationCacheFailure` both deviating from their shipped defaults in this same
environment; a full reload would reset those too, and neither has any evidence tying it to
this incident. Reverting them is out of scope here — restoring `loadGeneratorTraffic` alone is
the minimal change that addresses the verified cause.

## Caveat (stated, not assumed away)

Three flags deviating from shipped defaults simultaneously in the same live sandbox is
consistent with a deliberately-configured shared fault-injection state serving other
concurrent scenarios, not necessarily three independent accidents. This proposal is confident
(on the RCA's evidence) that load-generator's own code isn't at fault and that the mismatch is
in flag state, not code. It is **not** claiming certainty that flipping `loadGeneratorTraffic`
alone is risk-free to any other concurrent activity depending on the current flag
configuration — whoever executes this should confirm that first.

## Second opinion

A fresh, blind sub-agent reviewed an initial draft that offered "restart/reload flagd from
the shipped config file" as an equivalent alternative to a scoped update — it correctly flagged
that as internally inconsistent with the proposal's own stated scope (a reload would also reset
`cartFailure`/`recommendationCacheFailure`, which the draft said it wasn't touching). Revised to
drop the reload/restart path entirely and keep only the scoped update, plus made the
shared-fault-injection-state caveat explicit rather than implicit. The revision came back
**CLEAN** on re-review — see `remediation.status`/`second_opinion` in
`incidents/incident-002.json` for the verbatim verdict.

## No PR opened

Nothing in the git-tracked `open-telemetry/opentelemetry-demo` repo is wrong or needs a diff —
the upstream shipped default is already correct (`on`). The drift is purely in this live
environment's runtime flag store, outside version control and outside what any capability here
may write to. There is nothing to open a PR against.
