# Incident picture — 2026-08-09T12:27:00Z

## Open
- [sev2] inc-001: product-catalog GetProduct intermittently rejected by productCatalogFailure fault-injection flag; cascades HTTP 500s through cart/recommendations/product/checkout via frontend. Bursts 07:56-09:57 UTC; product-catalog idle since 10:07 UTC — no positive recovery evidence, only absence of exercise (1 alert, revised 1x). RCA verified; awaiting remediation.

## Resolved this session
- (none)

## Escalated
- (none — RCA already verified for inc-001; the only open question is observability, noted in its escalation.open_question, not a fresh hand-off)

## Shift notes
- log-triage raised zero new alerts this shift; the only "error" spans in the last hour are flagd EventStream subscriptions closing on 10-minute renewal (healthy long-poll behaviour), verified against a disconfirming Tempo query.
- Load-generator HTTP scenario is not producing requests this shift (loadGeneratorTraffic defaultVariant=off, k6_http_reqs_total flat at zero), which is *why* the previously-firing services look quiet — not because they're healthy.
