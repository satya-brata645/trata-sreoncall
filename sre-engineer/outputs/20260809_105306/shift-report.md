# Shift report — 2026-08-09 10:53–12:00 UTC

## Headline

One real anomaly this shift (a hidden observability blackout), tracked as two separate
incidents. Neither is a live customer-facing outage right now. One code fix (inc-001) was
proposed, independently re-reviewed, and **merged** ([PR #11](https://github.com/satya-brata645/trata-sreoncall/pull/11)).
The other (inc-002) turned out to have no code to fix at all — root-caused to a live
environment flag stuck off, correctly left unfixed by this project's own rules, and hand off
documented. Both incidents remain open pending real traffic returning to this sandbox.

## What was watched

`log-triage` swept all services in the shared LGTM stack over the last 30m/6h at shift start
(10:53:36Z): flagd's live flag list, a broad Loki error-keyword sweep across every
`service_name`, RED metrics (HTTP/gRPC status by service), and raw counter trends at 10-min
resolution for checkout, cart, product-catalog, and frontend-proxy going back 6 hours.

## Alerts

- **alt-001** (medium, confidence 0.8): load-generator's synthetic traffic to the storefront
  had been completely dark for 65+ minutes (since 09:57 UTC; underlying flag off since
  07:22:52 UTC), immediately preceded by a ~90-minute error spike on GetProduct/PlaceOrder.
  Direct manual probes (bypassing the load-generator) confirmed the app itself is healthy —
  200 OK on both the storefront homepage and a live product page, with product-catalog's own
  GetProduct-OK counter incrementing in response. Severity stayed at medium rather than
  high/critical precisely because of that direct-probe disconfirmation.

## Incidents

### inc-001 — product-catalog GetProduct failures (sev3, status: monitoring)
Root cause (confidence 0.97, code-verified): `checkProductFailure` in
`src/product-catalog/main.go` gates `GetProduct` on the `productCatalogFailure` flagd flag and
returns gRPC `Internal` before reaching the DB — the demo's fault-injection working as
designed, cascading HTTP 500s into cart, recommendations, product pages, and checkout. Peak
blast radius (07:56–08:20 UTC): ~47% of checkout attempts and ~38–47% of product-page loads
failed. Errors tapered to zero net growth by 09:57 UTC, but real traffic itself also stopped
at that exact instant for an unrelated reason (inc-002) — so recovery is **likely, not
confirmed**. One manual probe succeeded, but that's one data point against a flag that
evaluates per-request.
Remediation: reclassified the flag-triggered error from `codes.Internal` to
`codes.Unavailable` (correct transient-failure semantics; fault-injection mechanism left
fully intact) — [PR #11](https://github.com/satya-brata645/trata-sreoncall/pull/11), **merged**
2026-08-09T11:30:44Z after an independent re-review re-fetched the live source itself rather
than trusting the diff. Noted, not solved: no caller-side retry logic exists yet on the
frontend's product-catalog gateway, so this fix improves error semantics but doesn't by
itself reduce blast radius during a future occurrence.
Full detail: [postmortem-incident-001.md](postmortems/postmortem-incident-001.md).

### inc-002 — load-generator traffic dark / observability blind spot (sev3, status: open)
Root cause (confidence 0.85, verified against real upstream source): this sandbox's live
flagd instance evaluates `loadGeneratorTraffic` to `off`, deviating from the value shipped
upstream (`on`) in `open-telemetry/opentelemetry-demo`. The load-generator's own code is
behaving exactly as designed (`getFlagdValue('loadGeneratorTraffic') <= 0` correctly pauses
its scenarios) — there is no code bug, `implicated_file`/`implicated_function` are both
correctly `null`. Two other flags (`cartFailure`, `recommendationCacheFailure`) are also
currently live-deviating from their shipped defaults, suggesting a deliberately-configured
shared fault-injection state rather than three independent accidents — flagged, not assumed
away. Whether the 07:22:52 UTC flip was deliberate or a stuck toggle remains genuinely
undetermined.
Remediation: a scoped config proposal (restore `loadGeneratorTraffic` to `on` only, explicitly
**not** reloading flagd wholesale, which would also reset the two unrelated deviated flags) —
went through two rounds of independent second opinion (round 1 FLAGGED an internal scope
inconsistency, round 2 came back CLEAN after revision). No PR opened — nothing in the
version-controlled repo is wrong, and writing the live flag directly is outside every
capability's allowed tool surface (`/toggle` is project-wide off-limits). Release-approval
independently confirmed there was nothing to merge. This incident stays open until whoever
holds live flagd write access outside this project acts on the documented proposal.
Full detail: [postmortem-incident-002.md](postmortems/postmortem-incident-002.md).

## Resolved this shift

None. Both incidents remain open — see each incident's own escalation `open_question`.

## Escalated

Neither incident was escalated as unresolvable by alert-grouping; both carry an open question
handed to root-cause-analysis (recorded in their `escalation` fields), and both were
investigated this shift. See `incident-picture.md` for the live one-line view of each.

## What got learned this shift

- **log-triage**: the counter-selection lesson already on file — sum a load generator's
  request counters *by destination URL* before trusting "traffic never stopped," since
  flagd-polling traffic looks identical to app traffic in an unfiltered sum — held up and
  was applied correctly here (playbooks `correlate-with-flag-changes-but-dont-stop-there`,
  `check-dependencies-before-blaming-the-symptom`). No revision needed to existing playbooks
  this run.
- **alert-grouping**: reaffirmed "overlap in time is not proof of relatedness" against a real
  case where two faults onset within ~8 minutes of each other but shared no causal link —
  DECLAREd as two incidents rather than merged on coincidental timing.
- **remediation**: confirmed a `config_proposal` (no diff, no PR) is a legitimate output type
  distinct from `code_fix` when the verified RCA points at live environment/runtime state
  rather than versioned code — and that this project's `/toggle` prohibition applies even when
  the fix is well-understood and low-risk.
- **release-approval**: confirmed its four standard checks (source re-fetch, diff scope,
  reckless-pattern check, syntax validity) correctly don't apply to a non-existent diff, and
  that "nothing to review" still requires independent verification of *why* there's nothing to
  review, not just trusting remediation's claim.
- **reporting** (this capability): see its own upskilling entry below.

## For the next shift

- Do not resolve inc-001 on continued silence — the silence is explained by inc-002's traffic
  blackout, not by confirmed recovery. Resolving either incident requires resumed real traffic
  or repeated manual probes across multiple product IDs.
- inc-002 needs someone with live flagd write access (outside this project's tool surface) to
  execute the documented scoped config change (`remediations/incident-002/rationale.md`) —
  this project cannot close that loop itself.
- Once real traffic resumes, re-check whether `productCatalogFailure`-pattern errors (gRPC
  `Internal`/`Unavailable`, message `Error: Product Catalog Fail Feature Flag Enabled`) recur
  at any rate — that's the only evidence that actually confirms or reopens inc-001.
