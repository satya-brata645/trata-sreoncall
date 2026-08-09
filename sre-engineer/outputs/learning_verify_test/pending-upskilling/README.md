# Pending upskilling — written this shift, blocked on write permission

These files are this shift's durable-memory output. They are staged here because writes into
`capabilities/log-triage/.claude/skills/log-triage/` were not permitted in this session. I did
not route around that with a shell command — a denied write is a decision, not an obstacle to
work around.

**Nothing here is a draft.** Each file is final and belongs at the destination below.

## Destinations

```
BASE=sre-engineer/capabilities/log-triage/.claude/skills/log-triage

pending-upskilling/baselines/product-catalog.md   ->  $BASE/baselines/product-catalog.md
pending-upskilling/baselines/frontend.md          ->  $BASE/baselines/frontend.md
pending-upskilling/baselines/frontend-proxy.md    ->  $BASE/baselines/frontend-proxy.md
pending-upskilling/baselines/checkout.md          ->  $BASE/baselines/checkout.md
pending-upskilling/baselines/payment.md           ->  $BASE/baselines/payment.md
pending-upskilling/baselines/cart.md              ->  $BASE/baselines/cart.md
pending-upskilling/baselines/flagd.md             ->  $BASE/baselines/flagd.md
pending-upskilling/baselines/otelcol-contrib.md   ->  $BASE/baselines/otelcol-contrib.md

pending-upskilling/experiences/quiet-shift-after-fault-clear-flagd-eventstream-noise.md
                                                  ->  $BASE/experiences/<same name>
```

To land them from the repo root:

```sh
BASE=sre-engineer/capabilities/log-triage/.claude/skills/log-triage
SRC=sre-engineer/outputs/learning_verify_test/pending-upskilling
cp "$SRC"/baselines/*.md   "$BASE"/baselines/
cp "$SRC"/experiences/*.md "$BASE"/experiences/
```

## Why this matters more than usual

`baselines/` contained **only `FORMAT.md`** before this shift — zero service baselines existed,
so every evaluation this shift compared against nothing. These eight files are the first ones.
If they aren't landed, the next shift starts from nothing exactly as this one did, and the
flagd `EventStream` trap that nearly produced two false pages today (payment at an apparent
~1.4% error rate on the revenue path; a checkout trace flagged `error` whose order actually
completed) is available to catch the next shift the same way.

`experiences/` was likewise empty. Per the project's own rule, an empty `experiences/` folder
after a working shift means the shift did not finish properly.

## Already landed successfully (not pending)

- `corrections/log-triage/20260809-130000-quiet-window-is-not-recovery.md` — `status: open`
  → `status: applied`, with an `applied_note` recording how it was applied and what it changed.
- `outputs/learning_verify_test/evaluation.md` — the required per-service baseline evaluation.
- `outputs/learning_verify_test/logs/log-triage.jsonl` — the full reasoning trace.

## Not written, deliberately

No playbook. The candidate — *"When a service shows a low, suspiciously constant error rate,
check whether the error signal tracks request volume before treating it as user-facing"* —
survived a duplicate search but the playbook bar requires a fresh blind refuter sub-agent, and
this session was directed not to spawn one. Writing it anyway, or recording a refuter verdict I
never obtained, would leave a file that looks vetted and isn't. The candidate is preserved
verbatim at the end of the experience entry.

No alerts. `alerts/` is empty because nothing warranted one, which is a valid and in this case
correct outcome — not an omission.
