# Postmortem — incident-001

## What happened

`product-catalog`'s `GetProduct` gRPC call intermittently rejected requests behind the
`productCatalogFailure` flagd flag, returning a gRPC `Internal` error before ever reaching the
database. Because nearly every user-facing route (product detail, cart, recommendations,
checkout) calls `GetProduct` to hydrate product data, one upstream fault cascaded into HTTP
500s across all of them. At peak (07:56–08:20 UTC), ~47% of checkout attempts and ~38–47% of
product-page loads failed. This was the demo's own fault-injection code path executing
correctly as designed, not an accidental bug in the check itself.

## Timeline

- **~07:19–07:27 UTC**: onset window. The `productCatalogFailure` flag begins triggering
  `GetProduct` failures; frontend's client-side spans show an escalating, fluctuating error
  rate (25–100% in several 10-minute windows) through 08:57 UTC.
- **07:56–08:20 UTC**: peak burst — ~47% checkout failure rate, ~38–47% product-page failure
  rate across all 10 catalog product IDs.
- **08:57–09:57 UTC**: error-count trend decelerates monotonically (8038 → 8439 → 8487 → 8643
  → 8736 → 8804 → 8804 per 10-min bucket), the first genuine tapering evidence beyond "no new
  burst yet."
- **09:57 UTC**: success-count growth also stops — but for an unrelated reason (inc-002's
  load-generator traffic blackout), not because this fault cleared. This is the point at
  which "quiet" stopped being distinguishable from "recovered."
- **~10:58 UTC**: one manual direct probe (`GET /api/products/0PUK6V6EV0`) returns 200 and
  increments `product-catalog`'s GetProduct-OK counter by exactly 1 — a real data point, but a
  single request against a flag that evaluates per-request.
- **2026-08-09T11:09:00Z**: this shift's alert-grouping revision — downgraded sev2 → sev3
  (no currently-measured active harm) but kept status at `monitoring`, not `resolved`,
  because the evidence is a gap (traffic blackout), not positive proof of recovery.
- **2026-08-09T11:15:00Z**: this shift's RCA pass reviewed the existing verified RCA against
  the new evidence, found neither new thread bears on the causal mechanism, and left the RCA
  unchanged (`REVIEW_NO_REINVESTIGATION`).
- **2026-08-09T11:30:44Z**: PR #11 merged after independent re-review.

## Root cause

`GetProduct` in `src/product-catalog/main.go` calls `checkProductFailure`, which evaluates the
OpenFeature/flagd boolean flag `productCatalogFailure` (default `false`, binding
`flags.ProductCatalogFailure`) per-request, keyed on `product_id` via a targetless evaluation
context. When the flag evaluates `true`, `GetProduct` returns before calling
`getProductFromDB`, with gRPC code `Internal` (13) and the literal message `Error: Product
Catalog Fail Feature Flag Enabled` — matching trace evidence verbatim
(`rpc.grpc.status_code=13`, `grpc.error_message` text identical). Confidence: 0.97.

**Independent verification**: a fresh sub-agent, given only the bare claim (file, function,
line numbers, exact error message, ordering relative to the DB call) and no prior reasoning,
re-fetched `src/product-catalog/main.go` from `open-telemetry/opentelemetry-demo` directly and
confirmed every element verbatim — `GetProduct` calling `checkProductFailure` at line 373,
the flag evaluation at lines 419–420, and the error branch at lines 374–377. Verdict:
CONFIRMED.

## Remediation

**Type**: code fix. Reclassified the flag-triggered failure from `codes.Internal` to
`codes.Unavailable` (`main.go:377`) — correct error semantics per grpc-go's own documentation
for an intentionally transient, flag-simulated failure. The fault-injection mechanism itself
(the flag, `checkProductFailure`, the error message text used for log/trace-based detection)
is untouched.

**Second opinion** (blind sub-agent, given only the diff and verified RCA facts, not the
authoring reasoning): **PASS** — "a narrow, correctly-scoped, non-destructive change: it
improves error semantics for a genuinely transient, intentionally-injected failure, leaves the
fault-injection mechanism fully intact, and doesn't remove, weaken, or hide anything." Noted
limitation, not a blocker: this doesn't by itself reduce blast radius without caller-side
retry logic — `src/frontend/gateways/rpc/ProductCatalog.gateway.ts` was read and confirmed to
have none today.

**Release approval**: independently re-fetched the live upstream source (not trusted from
remediation's copy) and confirmed all four standard checks — the diff matches the real current
code verbatim, the fault-injection mechanism is untouched, the change is minimally scoped
(one functional line + comment, only new files added to the team's own repo), no reckless
pattern (no swallowed error, no removed check, detection-relevant message text unchanged),
and `codes.Unavailable` is syntactically valid, pre-existing in the same package. **Decision:
merged**, 2026-08-09T11:30:44Z, commit `040d1b43ae333c02f935baa7332ffa8342597e87`. PR:
[trata-sreoncall#11](https://github.com/satya-brata645/trata-sreoncall/pull/11).

## Impact

- Peak window (07:56–08:20 UTC): ~47% of checkout attempts failed; ~38–47% of product-page
  loads failed across all 10 catalog product IDs; recommendations failed at a comparable rate.
- As of 09:57 UTC, real traffic to the entire storefront stopped completely (inc-002), so
  current blast radius cannot be measured directly — the only post-blackout evidence is the
  single manual probe above.

## What was learned

No new playbook entry was written for this incident specifically — alert-grouping's existing
heuristic ("overlap in time is not proof of relatedness") and its own revision reasoning
(treating log-silence at the app layer as *predicted by*, not evidence against, a root cause
that returns errors before app-level logging) held up without needing revision. RCA's own log
this shift recorded explicitly that neither new evidence thread this run changed the causal
mechanism, and left the verified RCA unchanged rather than re-investigating for its own sake.
