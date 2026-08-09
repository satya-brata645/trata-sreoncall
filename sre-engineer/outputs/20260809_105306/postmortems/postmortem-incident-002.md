# Postmortem — incident-002

## What happened

The load-generator — the only traffic source that exercises this sandbox — stopped driving
any real application traffic to the storefront for 65+ minutes, and remains stopped. The app
itself is verified healthy by direct probe. The real cost isn't user impact; it's that this
environment currently has no ability to detect any regression, including whether inc-001 has
actually recovered.

## Timeline

- **~07:19 UTC**: load-generator's own request/iteration counters reset, consistent with a
  container restart.
- **07:22:52 UTC**: `loadGeneratorTraffic` flag first logged evaluating to `0`/off
  (`{service_name=~"(opentelemetry-demo/)?load-generator"} |= "loadGeneratorTraffic evaluated
  to 0"`), and has evaluated off continuously since.
- **09:57 UTC**: all app-facing traffic (frontend-proxy, frontend, product-catalog, cart,
  checkout) flatlines completely — this is the point the load-generator's scripted scenario
  fully drained out, even though the process itself (`k6_vus` steady at 6, flagd-polling
  traffic climbing throughout) never stopped.
- **2026-08-09T11:09:00Z**: this shift's alert-grouping DECLAREs this as a separate incident
  from inc-001 — different flag, different mechanism (pauses traffic vs. injects errors into
  served requests) — rather than merging on the ~8-minute onset overlap.
- **2026-08-09T11:35:42Z**: RCA investigation completes and verifies.
- **2026-08-09T12:00:00Z** (approx.): release-approval independently confirms nothing is
  mergeable; incident-002 stays open.

## Root cause

This is a configuration/environment-level fault, not a code bug. This sandbox's live flagd
instance currently evaluates `loadGeneratorTraffic` to `off`, deviating from the value shipped
upstream in `open-telemetry/opentelemetry-demo`'s `src/flagd/demo.flagd.json`
(`defaultVariant: "on"`, `variants {off:0, on:1}`). `src/load-generator/script.js`'s
`httpScenario()` and `browserScenario()` both call `getFlagdValue('loadGeneratorTraffic')` and,
by design, skip traffic generation whenever it evaluates `<= 0` — the load-generator's own
code is correctly honoring an externally-set flag state, not malfunctioning. Two other flags
(`cartFailure`, `recommendationCacheFailure`) are also currently live-deviating from their
shipped defaults in the same direction, consistent with a deliberately-configured shared
fault-injection state rather than three independent accidents — flagged as a real
consideration, not resolved. Whether the specific 07:22:52 UTC flip was deliberately paired
with inc-001's fault injection or an unrelated stuck toggle remains genuinely undetermined; no
log or trace ties the two flag changes to a single triggering event. Confidence: 0.85.

**Independent verification**: a fresh, blind sub-agent re-fetched both
`src/flagd/demo.flagd.json` and `src/load-generator/script.js` from the real upstream repo
(given only the two literal claims, no investigation context) and confirmed both — the shipped
default is `on`, and the guard logic in both scenario functions matches exactly as described.
Verdict: CONFIRMED.

## Remediation

**Type**: config proposal — no code fix exists because there is no code defect
(`implicated_file`/`implicated_function` are both correctly `null`). Proposed a **scoped**
OFREP/admin update restoring `loadGeneratorTraffic` to `on` in this environment's live flagd
instance, explicitly ruling out reloading/restarting flagd wholesale from the shipped config
(which would also reset the two unrelated deviated flags, `cartFailure` and
`recommendationCacheFailure`). Full rationale: `remediations/incident-002/rationale.md`.

**Second opinion**, two rounds (blind sub-agent, given only the proposal text and verified RCA
facts):
- **Round 1 — FLAGGED**: the draft offered two "equivalent" implementation options, but the
  second (reload/restart flagd from the shipped file) would reset all three live-deviated
  flags, contradicting the proposal's own stated scope of leaving the other two untouched.
  Also flagged the three-simultaneous-deviations pattern as worth surfacing.
- **Round 2 — CLEAN**: after dropping the reload/restart option and adding the
  shared-fault-injection-state caveat explicitly, the reviewer confirmed the stated scope and
  the concrete mechanism now matched, with no overreach, no hiding, no hardcoding.

**No PR opened**: nothing in the version-controlled `open-telemetry/opentelemetry-demo` repo
is wrong — the shipped upstream default is already correct. The drift lives entirely in this
environment's live, unversioned flagd runtime state, which this project forbids any capability
from writing to directly (`/toggle` is off-limits, project-wide, always).

**Release approval**: independently confirmed there was nothing to review or merge — not
merely trusted remediation's claim. Re-checked `remediation.pr_url` is `null` and
`remediation.type` is `config_proposal`; independently ran `gh pr list --repo
satya-brata645/trata-sreoncall --state all` and found no PR referencing incident-002 or
`loadGeneratorTraffic`; re-read the rationale and verified RCA directly rather than
summarizing remediation's summary. **Decision: no_action_required.** Incident-002 remains
open pending action by whoever holds live flagd write access outside this project's tool
surface.

## Impact

No confirmed real-user impact: manual probes to the storefront homepage and a live product
page both returned HTTP 200 in under 120ms, with the product-page probe visibly incrementing
`product-catalog`'s own GetProduct-OK counter. The actual harm is a total observability blind
spot — zero real application requests for 65+ minutes (and counting), which directly blocks
confirming whether inc-001 has recovered.

## What was learned

Remediation's own upskilling note from this run: `config_proposal` (no diff, no PR) is a
legitimate and distinct output type from `code_fix` whenever a verified RCA points at live
environment/runtime state rather than versioned code — and the `/toggle` prohibition holds
even for a fix this well-understood and low-risk. Release-approval confirmed its four standard
checks correctly don't apply to a non-existent diff, and that "nothing to review" still
requires independent verification of *why*, not just accepting remediation's claim at face
value.
