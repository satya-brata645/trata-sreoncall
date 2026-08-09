---
name: verify-recovery-over-time
description: Treat a resolved incident as a hypothesis to check later; distinguish observed recovery from proof that it will last.
origin: professional-practice
kind: practice
times_applied: 0
---

Resolution is a point-in-time judgment from recovery evidence, not a promise that a remediation
was deployed or that the problem cannot return. In later checks, revisit the affected request
path with fresh logs, metrics, traces, and relevant change context. Compare the shape of the
new evidence with the original symptom rather than relying on an incident title or a quiet alert.

- Record whether recovery appears to have held, recurred, or remains inconclusive; make the
  distinction explicit.
- A recurrence needs evidence that the failure shape is comparable, not merely the same service
  name or a familiar-sounding error.
- Keep the original evidence and each follow-up evidence ref as provenance so a later reviewer
  can challenge the conclusion.
- If the evidence is incomplete, preserve the uncertainty and schedule another check instead of
  claiming the underlying fix held.

