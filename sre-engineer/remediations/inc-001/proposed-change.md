# Proposed change — inc-001 (product-catalog GetProduct failures)

**Type:** `config_proposal` (not a code fix — see `rationale.md` for why a patch to
`src/product-catalog/main.go` would be the wrong change, not merely a larger one)

**Status:** proposed. Not executed by this capability, by hard rule — `incident-remediation`
is read-only on the target system's fault-injection state and may never call flagd's
`/toggle`. This document is the change; someone with authority over the fault-injection
state has to be the one to apply it.

> **Revision 1.** The first draft of this proposal said the toggle call below "restores the
> flag to the definition already committed upstream." A blind reviewer showed that claim is
> not supportable, and it was the most load-bearing sentence in the document. The correction
> is not cosmetic — it changed the shape of the proposal from one step into a read-first,
> two-case procedure. What changed and why is at the bottom, under *Revision history*.

---

## What you are actually changing, and the one thing to check first

**Target:** the live flagd instance backing the demo deployment. Control API at
`http://10.10.1.141:4001`.

**Flag:** `productCatalogFailure` (boolean; Go binding `flags.ProductCatalogFailure`).

**Goal:** make `productCatalogFailure` evaluate `false` for every product ID, which closes the
only code path that produces this incident.

There are two different live configurations that would both produce the failures we saw, and
**they need two different changes.** Applying the wrong one looks like it worked until you
check the metrics. So this proposal is a read, then a branch — not a single call.

### Why there are two cases

flagd resolves `targeting` first. If `targeting` yields a valid variant name, that variant
wins and `defaultVariant` is never consulted. The `/toggle/<flag>/<on|off>` route is, by its
own signature, a variant selector — it sets `defaultVariant`. **It cannot reach a `targeting`
block.**

That matters because the committed upstream `targeting` for this flag is:

```json
"targeting": {
  "if": [ { "==": [ { "var": "product_id" }, "OLJCESPC7Z" ] }, "off", "off" ]
}
```

Both branches return `"off"`. Under the committed config this flag can never evaluate true —
not for any product ID, not even `OLJCESPC7Z`, and not even if `defaultVariant` were flipped
to `"on"`. But the incident demonstrably happened. **Therefore the live config has diverged
from committed, and we do not know in which field.**

The blast radius is the tell, and it points the same way. The flag describes itself as failing
"a specific product," and the committed rule names exactly one product ID — yet the incident
shows 38–47% failures across **all 10** catalog product IDs. Whatever is deployed is not
product-scoped the way the committed rule is. That is not a side curiosity about blast radius;
it is direct evidence that the `targeting` block specifically is what diverged.

### Step 0 — the cheap probe, over plain HTTP (30 seconds, no cluster access)

```
GET http://10.10.1.141:4001/status/productCatalogFailure
```

- If `defaultVariant` is **`"on"`** → you are in **Case A**. Act now; you do not need Step 1.
- If `defaultVariant` is **`"off"`** → Case A is **excluded**, and you need Step 1 to read
  `targeting` from the config source.

This is worth doing first because it is the only probe reachable without cluster/ConfigMap
access, and half the time it ends the investigation.

**As of this writing it reads `"off"`** — verified twice, independently, during this
remediation:

```json
{"ok":true,"flag":"productCatalogFailure","defaultVariant":"off","description":"Fail product catalog service on a specific product"}
```

So on current evidence **Case A's precondition is not met and you should expect Case B** —
which is exactly what the blast-radius evidence above predicts. Re-run this yourself rather
than trusting this paragraph; it is a point-in-time reading and the whole reason Step 0 exists
is that live state moves.

### Step 1 — read the deployed flagd config (do this before touching anything)

Read the actual config backing the live flagd — the deployed `demo.flagd.json`, ConfigMap, or
whatever source that instance is watching — and **record the entire `productCatalogFailure`
object**, then diff it against the committed upstream definition.

Record the whole object, not just the two fields this proposal talks about. That is a
deliberate instruction, not thoroughness for its own sake: the defect in the first draft of
this proposal was that the divergence sat in a field nobody thought to check. Naming only
`targeting` and `defaultVariant` re-creates that exact exposure one level down. Two concrete
ways it bites:

- **`variants` remapping.** If the live manifest has `"variants": {"off": true, "on": false}`,
  or any remap binding `off` to `true`, then the Case A toggle selects variant `off` and the
  flag *still* evaluates true — **and Case B's remedy also fails**, because it restores
  `targeting` while leaving variants untouched. Neither case below handles this. I rate it
  unlikely (a `/toggle/<flag>/<on|off>` API selects variant *names*, so inverting the values
  would break toggle semantics for every flag), but a whole-object diff catches it for free
  and a two-field read does not.
- **`state`.** `state: "DISABLED"` yields the SDK code default `false`, so it cannot be the
  current shape — but record it anyway so your rollback restores what was actually there.

**Do not try to read `targeting` through the control API — it cannot tell you.** `/status`
gives you `defaultVariant` (which is what makes Step 0 useful) but returns no targeting block
at all:

```
GET http://10.10.1.141:4001/status/productCatalogFailure
{"ok":true,"flag":"productCatalogFailure","defaultVariant":"off","description":"Fail product catalog service on a specific product"}
```

`/list` is the same shape for all 15 flags. There is no read-only evaluation route either —
`POST /ofrep/v1/evaluate/flags/productCatalogFailure` returns
`{"ok":false,"error":"unknown route. Use /toggle/<flag>/<on|off>, /status/<flag>, or /list"}`.
So the control API can rule Case A *in* (Step 0), but only the config source can confirm
Case B. That asymmetry is why there are two read steps rather than one.

### Step 2 — apply the change for the case you are actually in

**Case A — `defaultVariant` is `"on"`, and `targeting` is absent, empty, resolves to `"off"`, or resolves to null.**
The variant selector is what's injecting the fault, so the toggle is sufficient. (Null is
included deliberately: flagd falls back to `defaultVariant` when a targeting rule returns
null, so that state behaves as Case A and the toggle is the right remedy for it.)

```
POST http://10.10.1.141:4001/toggle/productCatalogFailure/off
```

**Case B — `targeting` is present and resolves to `"on"` (for all products, or more than the one committed product).**
The toggle above is a **silent no-op** — targeting wins regardless of `defaultVariant`. The
required change is to the config source: restore `productCatalogFailure.targeting` to the
committed upstream form, and leave the rest of the flag exactly as it is:

```json
"productCatalogFailure": {
  "description": "Fail product catalog service on a specific product",
  "state": "ENABLED",
  "defaultVariant": "off",
  "variants": { "off": false, "on": true },
  "targeting": {
    "if": [ { "==": [ { "var": "product_id" }, "OLJCESPC7Z" ] }, "off", "off" ]
  }
}
```

then let flagd pick up the change (it watches its source; no service restart of
`product-catalog` is needed — the flag is evaluated per-request at
`main.go:419–420`).

Restoring this `targeting` block is robust to whatever `defaultVariant` holds — because
targeting wins, Case B resolves to `off` even if `defaultVariant` was left at `"on"`. You do
not need to also toggle.

**Neither case matches?** If Step 1's whole-object diff shows the divergence is somewhere
other than `targeting` or `defaultVariant` — `variants` remapped being the realistic one — then
**stop and do not apply either remedy**, because both assume variant *names* still bind to
their usual values. Restore the whole `productCatalogFailure` object to the committed form
above instead of patching one field, and say in the incident record that the injection
mechanism was not the one this proposal anticipated. Guessing at that point would put you back
in exactly the position this proposal's first draft was in.

Note what stays the same in every case: `state` remains `ENABLED` and both variants remain
defined. We are selecting a value, not deleting the fault-injection mechanism. Nothing here
removes anyone's ability to run this scenario deliberately later.

No file in any repository needs to change. The committed upstream config is already correct
in every branch; this is runtime drift, and drift is corrected at runtime.

## Why this closes the incident

The verified root cause is that `GetProduct` returns
`status.Error(codes.Internal, "Error: Product Catalog Fail Feature Flag Enabled")` *before*
reaching `getProductFromDB`, whenever `checkProductFailure` evaluates `productCatalogFailure`
to true for that request (`src/product-catalog/main.go`: call at 373, error branch 374–377,
DB lookup only at 380, `checkProductFailure` at 419–420 — read directly, quoted under
Evidence).

That branch has exactly one input: the flag's value. Nothing else in the request path can
reach it, and that literal string appears at exactly one site in the service — the other
`GetProduct` failure mode returns `NotFound`, not `Internal`. So making the flag evaluate
false closes the fault at its only source, and every downstream 500 in cart, recommendations,
product detail, and checkout stops with it. Those are all the *same* failure seen from a
caller's side, not four independent problems.

## Verification after applying (this is also how you find out if you guessed the case wrong)

1. Error-status `traces_span_metrics_calls_total` for `product-catalog`, over a **15-minute**
   window after the change. It must be flat zero. 15 minutes is chosen against this incident's
   own observed behaviour, not arbitrarily: every quiet gap during the incident (08:23–08:29,
   08:41–08:47, and the ~7-minute gap after 08:50) was under 10 minutes and was followed by
   another burst. A shorter window proves nothing — it is indistinguishable from the gaps the
   incident was already producing.
2. Checkout success rate returns to baseline. During bursts it was 144 failed / 162 ok
   (~47% failing); it should return to the ~1.8% background failure rate that unrelated,
   non-`product-catalog` routes showed throughout (e.g. `/api/data?contextKeys=accessories`).
3. Product detail loads succeed across **all 10** catalog product IDs, not just some. This one
   is not redundant with (2): partial success across product IDs is the specific signature of
   a `targeting` rule still selecting `"on"` for a subset.

**If (1) does not hold, you were in Case B and applied Case A.** That is the expected way to
discover it, and it is why the verification window is worth waiting out rather than declaring
success on the first quiet minute. Go back to Step 1 and read the `targeting` block.

Only after (1) holds for the full window should inc-001 move to `resolved`. Until then it
stays open — a quiet gap is not a recovery, which is the same reasoning that kept it open when
it was declared.

## Rollback

Reverting means putting back whatever Step 1 recorded — which is why Step 1 says to record it,
not just read it. For Case A that is `POST /toggle/productCatalogFailure/on`; for Case B it is
restoring the `targeting` block you replaced. Single boolean either way, no migration, no
dependent state, no restart.

**But do not reach for rollback if verification fails.** Re-enabling the flag re-injects the
fault; it is correct only as "restore prior state," never as a response to the fix not working.
If the error rate does not go to zero, you are in Case B and the action is to go read the
`targeting` block — not to turn the failure back on.

## Evidence I actually read for this proposal

- `curl https://raw.githubusercontent.com/open-telemetry/opentelemetry-demo/main/src/product-catalog/main.go`
  — read `GetProduct` and `checkProductFailure` first-hand. Quoted verbatim:
  - L373: `if p.checkProductFailure(ctx, req.Id) {`
  - L374: `msg := "Error: Product Catalog Fail Feature Flag Enabled"`
  - L377: `return nil, status.Error(codes.Internal, msg)`
  - L380: `found, err := getProductFromDB(ctx, req.Id)` — reached only if the branch is not taken
  - L419–420: `return flags.ProductCatalogFailure.Value(ctx, openfeature.NewTargetlessEvaluationContext(map[string]any{"product_id": id}))`
- `gh api repos/open-telemetry/opentelemetry-demo/contents/src/flagd` — located
  `demo.flagd.json` rather than assuming the path.
- `curl .../src/flagd/demo.flagd.json` — read the committed `productCatalogFailure`
  definition, including the both-branches-`"off"` targeting rule that the whole two-case
  structure above turns on. This is also what establishes that the repo default is already
  correct and the deviation is a runtime one.
- `GET http://10.10.1.141:4001/status/productCatalogFailure` and `GET /list` — quoted above;
  what establishes that the control API exposes variant and description only, with no
  targeting and no evaluation route.

## What I could not read, stated plainly

**I could not read the flag's live evaluated value, or the live `targeting` block.** The
control API exposes only the static manifest fields shown above, and its only route that
touches live state is `/toggle`, which I may not call. That limitation is the entire reason
this proposal is a read-first branch instead of a single call: I cannot determine from here
which of Case A or Case B is true, so I am not going to pretend one of them is and hand over
a call that might silently do nothing.

Separately, **"the flag is currently on" is an inference, not something I read.** It is a
strong one: the literal string `Error: Product Catalog Fail Feature Flag Enabled` is emitted
from exactly one branch in the entire service, and that branch is unreachable unless the flag
evaluated true — so the flag *was* true for the failing requests, beyond doubt. What I cannot
confirm is whether it is *still* true right now, during the quiet period. If it has already
been toggled off since the 08:50 burst, this proposal is a no-op and the incident should be
verified resolved instead of remediated. Step 1 answers that too, which is the other reason to
do it first.

## Secondary observation — NOT remediated here, and not something I'd fix blind

**The cascade is arguably the more interesting reliability defect.** One non-essential
dependency returning `Internal` turns into user-visible HTTP 500s on cart, product detail,
recommendations, and ~47% of checkouts. A frontend that degraded — cached product data, a
partial render, a retry — would have contained this. But `rca` verified
`src/product-catalog/main.go` only; it did not verify any frontend file, and I have not read
one. Proposing a resilience patch against code I have not read, for a cause that was not the
verified one, is exactly the kind of confident-sounding guess that costs the next person time.
It belongs in the postmortem as a recommendation, and in a future shift as its own
investigation with its own evidence — not smuggled into this change.

(The other thing I originally listed here — the all-10-product-IDs blast radius versus the
flag's "specific product" contract — is no longer a loose end. It has been promoted into the
body of the proposal, because it is the evidence that `targeting` diverged.)

## Revision history

**Rev 1**, after blind review. The reviewer independently re-read `main.go` and
`demo.flagd.json` and confirmed the root-cause attribution is airtight, but flagged one
substantive defect: because the committed `targeting` block returns `"off"` on both branches
and takes precedence over `defaultVariant`, the live config must have diverged in `targeting`
specifically — which is the one field `/toggle` cannot reach. So the original single call
could silently no-op, and the sentence claiming it "restores the definition already committed
upstream" was not supportable: a variant selector cannot restore a targeting block.

That was correct, and it was the sentence the whole proposal rested on. Changes made:

- Removed the "restores the committed definition" claim wherever it appeared.
- Replaced the single toggle call with Step 1 (read the deployed config first) and Step 2
  (Case A / Case B, with the toggle scoped to Case A only, and the actual config edit spelled
  out for Case B).
- Promoted the all-10-product-IDs mismatch from a "secondary observation, unaddressed" to
  primary evidence in the body — it is the reason to expect Case B.
- Corrected the reviewer's suggested remedy on one point of fact while keeping its substance:
  a pre/post diff via `/status` would not work, because `/status` returns only
  `defaultVariant` and `description` and never exposes `targeting` — I have the actual
  response showing this. The read has to be against the deployed config source, so that is
  what Step 1 says.
- Fixed the rollback section, which previously implied re-enabling the flag was a reasonable
  response to failed verification. It is not; the reviewer was right to call that out.
- Added product-ID-partial-success to the verification criteria as the specific signature of
  a still-live targeting rule.

**Rev 1a**, after the revision passed re-review CLEAN. Two hardening notes from the reviewer,
neither blocking, both adopted because they were cheap and right:

- **Added Step 0.** I had overcorrected on the `/status` point. `/status` genuinely cannot
  show `targeting` — that part of my correction stands — but it *does* show `defaultVariant`,
  which is the Case A predicate, and it is the only probe reachable without cluster access.
  Saying it "verifies nothing" threw away the cheapest first check. It is now Step 0, and
  Step 1 remains the more informative read.
- **Step 1 now records the whole `productCatalogFailure` object**, not two named fields, with
  the `variants`-remapping shape spelled out and a "neither case matches — stop" branch added
  to Step 2. The reviewer's argument for this is the one that convinced me: the defect in the
  first draft was that the divergence sat in a field nobody thought to check, and a two-field
  read reproduces that exposure one level down.
- Case A now names the null-targeting fallback explicitly, and Step 1 says to record `state`
  so rollback is faithful.

Also folded in the reviewer's live reading of `/status`, which independently matched my own:
`defaultVariant` is currently `"off"`, so Case A's precondition is not met and Case B is the
expected shape — the same thing the blast-radius evidence predicts.
