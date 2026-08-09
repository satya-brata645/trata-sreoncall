# Rationale — why inc-001 gets a `config_proposal` and not a `code_fix`

## The decision

The verified RCA names a real file and a real function
(`src/product-catalog/main.go`, `checkProductFailure`). By the crude reading of the type
rule, that points at `code_fix`. I chose `config_proposal` anyway, and the reason is not that
a patch would be *bigger* than I wanted — it's that a patch would be the **wrong change**.

## Why patching `main.go` would be wrong, not merely large

I read the implicated code. Here is the whole of the implicated branch:

```go
// GetProduct will fail on a specific product when feature flag is enabled
if p.checkProductFailure(ctx, req.Id) {
    msg := "Error: Product Catalog Fail Feature Flag Enabled"
    span.SetStatus(otelcodes.Error, msg)
    span.AddEvent(msg)
    return nil, status.Error(codes.Internal, msg)
}
```

and

```go
func (p *productCatalog) checkProductFailure(ctx context.Context, id string) bool {
    return flags.ProductCatalogFailure.Value(ctx, openfeature.NewTargetlessEvaluationContext(map[string]any{"product_id": id}))
}
```

This code has no defect. It reads a flag and, when the flag is true, does precisely and
correctly what the flag exists to make it do — including setting the span status, adding a
span event, and returning a typed gRPC error. That instrumentation is *why* this incident was
diagnosable at all: the exact string in the trace is the string on line 374. The RCA reached
the same conclusion independently and said so: "the demo's deliberate fault-injection code
path executing correctly as designed... not an accidental bug in the flag-check logic itself."

So the only patches available to me were:

- **Delete or bypass the flag check.** This removes the error path to make the errors stop.
  My own playbook names this exactly: "An error being caught and silently ignored is not a
  fix — it's the same failure with the evidence removed." It would also destroy a deliberate
  capability of the demo system, which is a new bug, not a fix for the old one.
- **Hardcode the flag to false.** "Preserve configurability, don't hardcode around it." The
  cause here *is* a flag; hardcoding around a flag is a narrower bug waiting for the next
  configuration.
- **Add a fallback/catch in `GetProduct`.** Same as the first, wearing better clothes.

Every available patch is either symptom-hiding or configurability-destroying. When the honest
options are all bad, the honest answer is that the change doesn't belong in this file.

## Why the config change is the real one

The cause of the *incident* is not that the branch exists. It's that the flag evaluated true
in production. That is a runtime configuration fact, and configuration is where its fix lives.
This is what `config_proposal` is for, by the skill's own definition — "the cause is
configuration/environment, not code."

The evidence sharpened this rather than just permitting it. I fetched the committed flag
definition from `src/flagd/demo.flagd.json` and found it is **already** `defaultVariant: "off"`,
with targeting that returns `"off"` on both branches. So there is no bad default checked in
anywhere to correct. The live deployment has drifted from a config that is already right. You
cannot fix drift with a commit — you fix it by putting the runtime back.

That fetch is also what stopped me writing a plausible, useless diff. Before I read that file
the obvious-looking move was "PR a change to `demo.flagd.json` setting it off," which would
have been a diff that changes nothing, against a file that is already correct, submitted with
a confident rationale. It would have looked like remediation and been worth nothing.

## Why not `deferred`

`deferred` means nothing safe to propose exists yet. That isn't true here. There is a
specific, concrete, verifiable, single-call, instantly-reversible change that closes the fault
at its only source, with defined success criteria and a rollback. Calling that "deferred"
would understate a real answer, which is its own kind of dishonesty — the mirror image of
padding.

What *is* deferred, and I've said so explicitly in the proposal rather than quietly: the
cascade-resilience question, and the mismatch between the flag's "specific product" contract
and its all-10-products blast radius. Both are real. Neither is something I can propose a fix
for from code I have not read.

## The honest weak point of this proposal

I could not read the flag's live value — the control API exposes only static defaults, and its
only live-state route is `/toggle`, which I am forbidden to call. So the proposal rests on an
inference: the failing spans carry a string that exists on exactly one unreachable-unless-true
branch, therefore the flag was true. That inference is solid for the *past*. It says nothing
about *now*. If the flag was already toggled off after the 08:50 burst, this proposal is a
no-op and inc-001 should be verified resolved instead.

I've put that limitation in the proposal itself, in its own section, rather than in a
footnote — because the person applying it needs to check that before they act, and burying it
would have been the difference between a fix and a waste of somebody's afternoon.

## What the blind review changed, and what I got wrong

The reviewer confirmed the root-cause attribution and agreed that config-over-code was correct
rather than a dodge. But it found a real defect, and it was in the sentence the proposal
rested on.

I had written that `POST /toggle/productCatalogFailure/off` "restores the flag to the
definition already committed upstream." That is not supportable. `/toggle` sets
`defaultVariant`. In flagd, `targeting` resolves first and wins whenever it yields a valid
variant — so a variant selector cannot restore, override, or even reach a `targeting` block.

Worse, I had the evidence that this mattered and filed it in the wrong place. I noticed that
the committed targeting rule returns `"off"` on *both* branches, and I noticed that all 10
product IDs were failing while the flag claims to fail "a specific product." I wrote both down
— and then listed the second one under "secondary observations, not remediated," as a curiosity
about blast radius. It isn't a curiosity. Put next to the first fact it is direct evidence that
the live config diverged in `targeting` specifically, which is precisely the field my proposed
call could not touch. The two facts were one inference apart and I left them in separate
sections.

The consequence was not a dangerous change — it was a change that could have quietly done
nothing, been reported as applied, and left the incident live while looking remediated. That
is its own kind of harm and it is exactly what a second pass is for.

The revision restructures the proposal from one call into a read-first, two-case procedure:
read the deployed config's `targeting` block first, then either toggle (Case A) or restore the
targeting block in the config source (Case B). I also fixed the rollback section, which had
implied that re-enabling the fault was a sensible response to failed verification. It isn't.

One point where I did not simply take the reviewer's word: it suggested a pre/post diff of
`/status/productCatalogFailure` to detect the divergence. That would not work — `/status`
returns only `defaultVariant` and `description`, with no `targeting` field at all, and I have
the actual response text showing it. The reviewer's substance was right and its mechanism was
wrong, so the revision keeps the check and points it at the deployed config source instead of
the control API. Adopting the suggestion verbatim would have handed over a verification step
that silently cannot verify anything — the same class of error it had just caught me making.

## Scope check against my own playbook

- Minimal, not clever: one boolean, no adjacent changes. Yes.
- Fix the cause, don't hide the symptom: this changes the condition that produced the
  failure. The instrumentation that made it observable stays completely intact, so a
  recurrence is still visible. Yes.
- Preserve configurability: the flag stays a flag, fully toggleable. Yes.
- Explainable in one paragraph: "The flag that gates the failure branch is on in the live
  deployment; turn it off; the committed default is already off." Yes.
