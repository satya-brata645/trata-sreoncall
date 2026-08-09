# Remediation for incident-001 — deferred

## Verdict
`type: deferred`, `status: deferred`. No PR opened, no diff written.

## The verified cause and why "deferred" is the honest outcome

RCA (verified twice, most recently 2026-08-09T12:35Z with a fresh Tempo trace inside the
extended burst window) concluded: `src/product-catalog/main.go::checkProductFailure`
evaluates the OpenFeature/flagd boolean flag `productCatalogFailure`; when that flag
evaluates true for a request, `GetProduct` returns `codes.Internal` with the exact literal
`Error: Product Catalog Fail Feature Flag Enabled` before reaching `getProductFromDB`. This
is the demo's fault-injection path executing exactly as designed. There is no bug in
`checkProductFailure` — the code is doing what it was written to do, when the flag is on.

The *cause of the failure* is therefore the flag's live variant being flipped to `on`, not a
defect in the Go code that reads it. That reframes what a "fix" would even mean here:

- **A code fix** — modifying `src/product-catalog/main.go` to remove or bypass the
  `checkProductFailure` gate — is exactly the reckless move the playbook warns against.
  Removing an upstream project's deliberate fault-injection feature so my own alert quiets
  down is hiding the symptom, not fixing a cause. The playbook line "fix the cause, don't
  hide the symptom" applies verbatim: the cause is not this function's existence.

- **A config change to the demo's flag manifest** — e.g. editing `src/product-catalog/flags.json`
  or `src/flagd/demo.flagd.json` — cannot address this incident either. The RCA already
  confirmed `defaultVariant: off`; the flag is only firing because the *live* variant was set
  to `on` externally. Rewriting the default doesn't override a runtime override, so the
  proposal would be theatre, not remediation.

- **The one action that actually would resolve this** — calling flagd's `/toggle` endpoint
  to set the live variant back to `off` — is prohibited by the project's hard rule (`No
  capability may call flagd's /toggle — this project is read-only on the real target system's
  fault-injection state, always.`, `sre-engineer/CLAUDE.md`). That rule is not something I
  route around; it exists precisely because the fault-injection state belongs to whoever runs
  the scenario, not to me.

So the honest outcome is: I understand the cause, I have no legitimate remediation to
propose that I am both permitted and confident is safe, and the incident stays open for the
next shift to either observe recovery (flag flipped off by the scenario owner, then real
traffic exercising product-catalog cleanly) or investigate a genuinely new symptom.

## What is *not* the reason for deferring
- Not "I couldn't reproduce it" — RCA has a verbatim trace-signature match on a burst inside
  this shift's window.
- Not "I didn't find the code" — the file, function, and error string are all cited and
  independently verified.
- Not "second opinion flagged the diff" — I did not write a diff; there was no candidate
  worth reviewing.

## What next-shift needs
- Live flagd variant published, not just default (currently flagd's `/status` publishes only
  `defaultVariant` — the observability gap the RCA already flagged).
- OR the load generator resuming traffic so a clean burst window (no errors) can positively
  confirm recovery. Silence-without-exercise is not recovery evidence.

## Handoff
Leaving `incident-001` open. No further action from this capability this shift.
