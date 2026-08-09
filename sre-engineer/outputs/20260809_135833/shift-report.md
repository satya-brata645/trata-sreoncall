# Shift Report — 2026-08-09T13:58:33Z

**Run:** `outputs/20260809_135833`
**Shift window observed:** ~30-minute telemetry window ending at 14:05 UTC, plus a 3-hour
span-metrics window for inc-001 recovery confirmation.
**Capabilities that ran this shift:** log-triage, alert-grouping (on-call-paging and
rca/remediation were not re-run — see below).

---

## What was watched

log-triage queried all three telemetry pillars (Mimir span metrics, Loki log streams, Tempo
traces) across the full service fleet, plus flagd `/list` and `/status` for the fault-injection
baseline.

---

## Alerts

**Zero new alerts this shift.**

The only non-zero error signals in Mimir were `flagd.evaluation.v2.Service/EventStream` spans
on ad, payment, and recommendation — a documented gotcha (long-lived subscriber spans that
carry ERROR status by construction, not from real business-logic failures). log-triage
cross-checked each against Loki and business-span metrics and confirmed all three services were
operating normally. Payment's apparent p99 of 15 s dropped to 2.0 ms when the EventStream span
was excluded, consistent with healthy behaviour.

---

## Incidents

### inc-001 — **Resolved this shift**

**Headline:** product-catalog GetProduct failures caused by `productCatalogFailure` flagd flag,
cascading HTTP 500s into cart, recommendations, product detail pages, and checkout.

**Resolved at:** 2026-08-09T14:05:00Z  
**Resolved by:** alert-grouping, on three-source verification:
- Mimir — `traces_span_metrics_calls_total{service_name='product-catalog', status_code='STATUS_CODE_ERROR'}` — 0/31 data points nonzero over 30 m.
- Loki — zero error/warn log entries for product-catalog over 30 m.
- Tempo — 10 sampled traces, all normal status, 1–9 ms.
- All blast-radius services (cart, checkout, frontend) at 0% errors; recommendation nonzero signal confirmed 100% EventStream artifact.

The deciding factor was the silence window: the incident's own documented inter-burst interval
was 5–10 minutes; the current clean window at time of resolution was 5+ hours (~30× that
interval). That is not a quiet gap matching the burst pattern — it is a break from it. That
distinction was the core of the resolution judgment, not a timeout.

**RCA:** Root cause was verified at 0.97 confidence: `src/product-catalog/main.go`,
`checkProductFailure`, evaluates `flags.ProductCatalogFailure` per request via OpenFeature/flagd;
when true, `GetProduct` returns `codes.Internal` with the literal message "Error: Product
Catalog Fail Feature Flag Enabled" before calling `getProductFromDB`. Every user-facing route
that calls `GetProduct` to hydrate product data cascades this error into HTTP 500s —
accounting exactly for the ~47% checkout failure rate and ~38–47% product detail failure rate
observed during active bursts. Verified blind by an independent sub-agent against the real
upstream source file.

**Remediation:** A config procedure was proposed and independently reviewed clean. No code change
is needed — the committed flagd manifest (`src/flagd/demo.flagd.json`) already has both
targeting branches returning `"off"`, so the incident was runtime drift, not a code defect.
The proposal is a read-first, two-case procedure to return `productCatalogFailure` to its
committed evaluation behaviour on the live flagd instance. **A merged PR does not apply this
change** — it's a runtime config operation. The PR is documentation: it puts the reviewed
procedure on record and in front of an operator with fault-injection authority.

**PR status:** Push was blocked by this environment's command guard (interactive confirmation
required; this runs unattended). The commit (`02f4299b8d84caefa352a4766a82306c7419dcb6`) is
preserved on branch `remediation/inc-001-product-catalog-1786278957` in
`/private/tmp/sreoncall-pr-inc-001-1786278957`. Exact push + `gh pr create` commands are in
`sre-engineer/remediations/inc-001/PR-PENDING.md`. Release-approval also reviewed (and
declined to approve) the older open PR #3 in the repo — it hardcodes a stale live-flag-state
claim and proposes a variant-only toggle that cannot reach a targeting block, making it
incorrect; it was left open, not merged.

**Paging:** The incident JSON carries no `paging` field — on-call-paging did not run this
shift. The incident was inherited as open from the prior run and resolved before paging was
re-evaluated. No paging decision was produced or needed for a resolved incident.

**Postmortem:** [postmortems/postmortem-inc-001.md](postmortems/postmortem-inc-001.md)

---

## What capabilities learned this shift

**alert-grouping** produced a candidate playbook addition on bursty-incident resolution
framing (the core insight: a silence window must be contextualized against the incident's own
known inter-burst interval to distinguish a quiet gap from a genuine break). The candidate
survived blind refutation but was weakened (the procedure was redundant; the insight is a
one-sentence annotation to the existing resolution heuristic). Write was blocked by the
environment's permission guard; candidate text is recorded in `logs/alert-grouping.jsonl` for
manual application.

No other upskilling material was produced this shift.

---

## What the next shift needs to know

1. **inc-001 is resolved, but the runtime state has not been formally corrected.** The flagd
   `productCatalogFailure` flag evaluated false for 5+ hours as of 14:05 UTC; why it stopped
   firing is not known (the live targeting state is unreadable from the control API). The
   proposed procedure is ready and reviewed. If errors resurface, the procedure is in
   `sre-engineer/remediations/inc-001/proposed-change.md`. The PR needs to be transported:
   see `PR-PENDING.md`.

2. **The only open PR relevant to inc-001 (PR #3) should not be merged.** Release-approval
   reviewed it and found two specific defects: a hardcoded stale state claim, and a remedy
   that cannot reach a flagd targeting block. It was left open, not approved.

3. **Frontend cascade resilience is an unaddressed risk.** One non-essential dependency's
   Internal error produced HTTP 500s on cart, product detail, recommendations, and ~47% of
   checkouts. No frontend file was read or verified this cycle; a future shift should
   investigate whether the frontend defensively handles upstream Internal errors or just
   passes them through.
