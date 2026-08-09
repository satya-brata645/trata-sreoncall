# Plan — close the Malleability gap and get the pipeline above 95

Goal: move the AI-native SREonCall detect-and-triage pipeline (`agent/`) from its current
self-assessed score of ~74/100 to 95+, by turning the two weakest, least-proven traits —
Malleability and Auditability — into things a judge can actually watch happen, not things
that merely should work.

Technical mechanism reference: **`PROMPT-skill-hooks-upgrade.md`** (untouched, not part of
this plan) — the Harvest→Judge→Refute→Gate→Write→Verify pipeline and the fresh-context loop
shape, both ported directly from `transilienceai/communitytools`'s `skill-update.js` and
`coordinator-loop.js`. This plan is the *execution* document: what gets built, in what order,
against what acceptance bar, and why each phase moves a specific score.

---

## Why these two traits, specifically

From the last honest scoring pass:

| Trait | Score | The actual gap |
|---|---|---|
| Malleability | 55 | The self-authoring loop exists and is mechanically correct, but every live test had one agent decide "write a skill or don't" unaudited — both times it declined, so the anti-gaming re-trigger demo (second run visibly better, citing what it learned) has never been observed. |
| Auditability | 82 | Evidence store is real, but nothing yet independently challenges an alert before it's raised — every alert so far has survived on one agent's first pass. |
| Agency | 75 | Long tool-use conversations in `triage.js`/`correlator.js` are what hit the shared 30k-TPM rate limit live in this session — a real ceiling on how long the system can run unattended without a redesign. |

All three trace back to one root cause: **single-agent, single-pass, long-context decisions.**
Fixing that one thing moves all three.

---

## Phase 1 — Pure-code gates (no model calls, ship first, zero risk)

These are testable without touching the API budget, so they go first.

1. `agent/src/skills/gates.js` — port `promotionGate`, `scrubIncidentIdentifiers`, and
   `skillContentGate` from the upgrade doc as pure functions.
2. Unit-test each with hand-built fixture judgments (no LLM involved) — confirm:
   - all-four-gates-true + no refutes → `PROMOTE`
   - any gate false → `SKIP` with the correct failed-gate name
   - majority refute → `REJECT` even if all four gates passed
   - a candidate body containing `errorRate > 0.05`-shaped text → rejected by
     `skillContentGate`, proving our own anti-threshold rule is now code-enforced, not just
     prompted.
3. **Acceptance**: all fixtures pass with zero API calls. This phase can be fully verified
   before spending any rate-limit budget on the rest.

## Phase 2 — Rebuild `skills/author.js` as the seven-stage pipeline

Per §1 of `PROMPT-skill-hooks-upgrade.md`: Harvest → Judge (4 gates + mandatory duplicate
search) → Refute (3 blind agents, only for candidates that would otherwise pass) → Gate
(Phase 1's pure functions) → Author → Write → Verify (round-trip through `loader.js`,
delete-on-failure).

**Acceptance**: run once against last session's synthetic memory-leak incident (the one that
correctly-but-unfalsifiably declined before). Confirm the new pipeline produces one of:
- a `PROMOTE` with a full Judge+Refute trail naming why it's genuinely new, or
- a `SKIP`/`REJECT` naming the *specific* failed gate or refuting agent's citation —

either outcome is now inspectable. A bare "no thanks" is no longer a valid output shape.

## Phase 3 — Fresh-context cycle (fixes Agency's rate-limit ceiling)

Per §2 of the upgrade doc: split the long `triage.js`/`correlator.js` tool-loops into short,
fresh-context steps (INVESTIGATE → DECIDE → SKEPTIC → CORRELATE → INTEGRATE), with `state.js`
as the file-backed memory between steps instead of one growing conversation.

**Acceptance**: run `npm start` continuously for 20+ minutes against live-toggled traffic
without hitting a 429 that isn't recovered by the existing retry logic. Compare token spend
per cycle against the old long-conversation shape — should drop materially since no step ever
re-sends the full accumulated tool history.

## Phase 4 — The SKEPTIC step (Auditability: 82 → 90+)

New, ported from `coordinator-loop.js`'s P4b skeptic role: before an alert is raised for real,
one fresh, blind agent tries to argue it's wrong (noise, already recovering, insufficient
evidence). A strong structured objection loops back to INVESTIGATE once; otherwise the alert
proceeds.

**Acceptance**: force one scenario with genuinely marginal evidence (single log line, no
corroborating trace) and confirm the skeptic actually blocks it — then force one with strong
multi-signal evidence and confirm it passes. Capture both transcripts.

## Phase 5 — The full re-trigger proof (the actual malleability demo)

This is the payoff phase — everything above exists to make this observable and defensible:

1. Run a controlled incident (the memory-leak or dependency-chain scenario) through
   DECLARE → RESOLVE using the Phase 2 pipeline. Expect a `PROMOTE`.
2. Re-trigger the same fault. Confirm the INVESTIGATE step cites the newly promoted skill by
   name, and the run is measurably faster or more confident than the first.
3. Save: both full transcripts, the Harvest→Judge→Refute→Gate trail, and the skill-file diff.
   These three artifacts together are the literal proof docs/03's anti-gaming section asks for
   — not asserted, attached.

## Phase 6 — Re-score

Re-run the honest self-audit from earlier in this conversation against the same rubric.
Expected movement: Malleability 55→90+, Auditability 82→90+, Agency 75→90+. Ownership and
Progressive Disclosure are untouched by this plan — they need the separate live exercises
already identified (force an `escalate_incident`, actually render all four disclosure levels
against real data), which stay as follow-up work, not part of this plan.

---

## What stays exactly as-is (do not touch)

- `PROMPT-signal-to-incident.md`'s triage/correlator system prompts and evidence-citation
  rules — validated, not in scope for this plan.
- `skills/base/*.md` — untouched.
- The AI-native gate (§0 of the main plan). Every gate function in Phase 1 is checked against
  the upgrade doc's §5 line-test before being written: it must only ever reference
  agent-reported structured judgments, never a raw telemetry value. If a gate function ever
  needs to read a metric directly, stop — that's the line.

## Order of work

Phase 1 → Phase 2 → Phase 5 (a first pass, even before Phase 3/4, since it's the fastest path
to the actual proof artifact) → Phase 3 → Phase 4 → Phase 5 again (full version, with the
skeptic step included) → Phase 6.
