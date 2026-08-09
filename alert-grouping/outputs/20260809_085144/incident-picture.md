# Incident picture — 2026-08-09 08:58 UTC

## Open
- [sev2] inc-001: product-catalog intermittently rejects GetProduct (own span cites a "Product Catalog Fail Feature Flag"), cascading 500s into cart, recommendations, product pages, and checkout. Sustained heavy failure 07:56-08:20 UTC, now tapering in bursts every 5-12 min, most recent burst 08:50 UTC. (1 alert, 0 revisions)

## Resolved this session
- (none)

## Escalated
- (none)

---
**Impact right now**: during active bursts, ~47% of checkout attempts and ~38-47% of product/recommendation page loads fail. Unaffected: routes not depending on product-catalog (~1.5-1.8% baseline failure).

**Cause**: product-catalog's own trace span carries `Error: Product Catalog Fail Feature Flag Enabled` (grpc INTERNAL). flagd lists a matching flag `productCatalogFailure` ("Fail product catalog service on a specific product") but only exposes its static default (`off`), not live state — the flag hypothesis is corroborated by the trace evidence, not confirmed by flagd itself.

**Why still "open", not "resolved"**: no alert fired in the last ~2 minutes, but the last hour shows repeated quiet gaps of 5-12 minutes between bursts throughout the tapering phase — absence of a recent burst is not, by itself, evidence of recovery.

**Drill down**: `alerts/alert-001.json` (full evidence/disconfirming checks), `incidents/incident-001.json`, `logs/log-triage.jsonl`, `logs/alert-grouping.jsonl`.
