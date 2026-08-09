# Remediation rationale — incident-001 (inc-001)

## What changed

One line, in `src/product-catalog/main.go`, inside `GetProduct` (the RCA's verified
implicated function's caller path — the change sits in the same `if p.checkProductFailure(...)`
branch as `checkProductFailure` itself, main.go:373-378):

```go
-		return nil, status.Error(codes.Internal, msg)
+		return nil, status.Error(codes.Unavailable, msg)
```

Nothing else. The flag (`productCatalogFailure`), `checkProductFailure`'s evaluation logic, and
the error message text are all untouched.

## Why this, and not something else

The verified root cause (this incident's `rca.root_cause`, confidence 0.97, gh-verified against
the real `src/product-catalog/main.go` lines 373-380 and 419-420) is explicit that
`checkProductFailure` gating `GetProduct` on the `productCatalogFailure` flag is **the demo's
deliberate fault-injection code path executing correctly as designed... not an accidental bug
in the flag-check logic itself.** That statement is a hard constraint on what a legitimate fix
can be: there is no real bug in *whether* or *when* this code fails, so a fix that changes that
behavior (disabling the flag check, hardcoding a bypass, or softening it into a non-error) would
not be fixing a cause — it would be neutering intentional fault-injection scaffolding, which
`./playbooks/patch-proposal-technique.md`'s "preserve configurability" rule rules out, and which
this SRE's own read of the incident agrees is not actually broken.

What *is* independently, verifiably wrong is the **error classification** used when the flag
fires. `GetProduct` returns `status.Error(codes.Internal, msg)`. gRPC's own reference
implementation (`grpc-go/codes/codes.go`, fetched and quoted verbatim for this fix) documents
`codes.Internal` as:

> Internal errors. Means some invariants expected by underlying system has been broken. If you
> see one of these errors, something is very broken.

That is not what is happening here. The flag manifest (`src/product-catalog/flags.json`,
already cited in this incident's RCA) describes `productCatalogFailure` as simulating "a
potential product catalog failure scenario" — i.e. a deliberately transient, expected condition,
not an invariant violation. `codes.Unavailable` is gRPC's own documented code for exactly this
case:

> Unavailable indicates the service is currently unavailable. This is a most likely a transient
> condition and may be corrected by retrying with a backoff.

Mislabeling an intentionally transient condition as `Internal` is a real, independently-checkable
defect (it's wrong by gRPC's own spec, not just a matter of taste), and it is the smallest
possible change that corrects it without touching the fault-injection mechanism itself, which
matches the incident's actual verified cause and nothing more (`patch-proposal-technique.md`'s
"minimal, not clever" and "fix the cause, don't hide the symptom" rules).

## What this does and does not do — stated plainly

This fix corrects the error's *classification* per gRPC's own contract. It does **not**, by
itself, reduce the incident's blast radius (checkout ~47% failure, product pages 38-47% across
all 10 product IDs during active bursts, per this incident's `blast_radius`), because neither
`src/frontend/gateways/rpc/ProductCatalog.gateway.ts` (the frontend's product-catalog client,
read directly for this fix) nor any other caller in the affected chain (cart, recommendations,
checkout) currently implements retry-on-`Unavailable` logic — confirmed by reading
`ProductCatalog.gateway.ts`, which rejects the promise on any error with no retry path at all.

Correcting the status code is a real, standalone fix to a real defect (mislabeled error
semantics), and it is also the prerequisite for any future caller-side retry/circuit-breaking to
even be possible — a client can't safely retry on `Unavailable` today because the server never
sends that signal. Actually closing the blast-radius gap would require adding resilience
(retry-with-backoff, a fallback render, or a circuit breaker) in every calling service, which
touches multiple files across multiple services and is not a minimal, single-cause fix — it is
flagged here as necessary follow-up work for a future incident/remediation pass, not silently
folded into this PR or claimed as solved by it.

## Evidence trail

- `rca.root_cause`, `rca.verify_detail`, `rca.evidence_refs` on `inc-001` (already gh-verified
  against `src/product-catalog/main.go` lines 373-380, 419-420).
- `src/product-catalog/main.go` (this fix, re-fetched from
  `raw.githubusercontent.com/open-telemetry/opentelemetry-demo/main/src/product-catalog/main.go`)
  — `GetProduct` lines 366-402, confirming the exact call site and current `codes.Internal` use.
- `src/product-catalog/flags.json` (already cited in this incident's RCA) — flag description
  "simulates a potential product catalog failure scenario" (transient, not an invariant defect).
- `grpc-go/codes/codes.go` (`github.com/grpc/grpc-go`, fetched for this fix) — verbatim doc
  comments for `Internal` (code 13) and `Unavailable` (code 14), quoted above.
- `src/frontend/gateways/rpc/ProductCatalog.gateway.ts` (fetched for this fix) — confirms no
  retry logic exists on the caller side today, which is why this fix's practical effect is
  scoped to correct error semantics, not blast-radius reduction, until a follow-up adds retries.
