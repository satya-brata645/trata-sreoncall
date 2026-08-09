# alert-grouping — AI-native logs → alerts → incidents, one shift per run

This project runs the detection-and-triage shift for the OpenTelemetry Demo app monitored by
the shared hackathon LGTM stack. It is invoked non-interactively: `claude -p` from this
directory, once per shift/cycle (see `run.sh`).

## The gate, before anything else

Delete every reasoning step in this session and nothing should come out — no alert, no
incident, no learned skill, silence. If any step ever becomes a fixed rule instead of
reasoning (a threshold, a keyword list, a same-service-within-N-minutes grouping rule, a vote
count standing in for a judgment), that step has failed and must be redone as reasoning. This
is checked before anything else, every run.

## What you do, in order, every invocation

1. **Create `$OUTPUT_DIR`** = `outputs/<YYMMDD_hhmmss>/` with subfolders `alerts/`,
   `incidents/`, `logs/`. Export `OUTPUT_DIR` as a fact both skills below read.
2. **Run the `log-triage` skill** (`.claude/skills/log-triage/SKILL.md`). It sweeps live
   telemetry and may raise zero or more alerts.
3. **Always run the `alert-grouping` skill next** (`.claude/skills/alert-grouping/SKILL.md`),
   even if step 2 raised nothing — it still needs to check whether any already-open incident
   (from a previous run's `incidents/*.json`, if present) has recovered.
4. **If `alert-grouping` RESOLVEd an incident this run**, invoke the `self-skilling` skill
   (`.claude/skills/self-skilling/SKILL.md`) once, for that incident. Never invoke it from
   inside `log-triage` or `alert-grouping` directly — this step is yours alone to trigger, so
   it's never accidentally skipped or accidentally duplicated.
5. **Rewrite `$OUTPUT_DIR/incident-picture.md`** — the single-file progressive-disclosure
   headline a human reads first (see `alert-grouping/SKILL.md` § Incident picture for the
   exact shape). This file alone should tell a human everything they need at a glance; the
   JSONL logs and per-alert/incident JSON are the drill-down layers underneath it.
6. **Do not ask the user anything.** This runs unattended. If something is genuinely
   ambiguous, that's what `alert-grouping`'s `ESCALATE` action is for — write it to the
   incident JSON and the incident picture, don't block waiting for input.

## Prior state

If `outputs/` already has a previous run's `incidents/*.json` with `status` other than
`resolved`/`closed`, copy them into this run's `$OUTPUT_DIR/incidents/` before step 2 — an
open incident from a prior shift is still open until this run's `alert-grouping` step
resolves or escalates it, on real evidence, not because a new shift started.

## Environment

`.env` at the repo root two levels up (`../../.env`) has `MANAGED_MIMIR_URL`,
`MANAGED_LOKI_URL`, `MANAGED_TEMPO_URL`, `MANAGED_LGTM_ORG_ID`. Requires VPN/office network
access to `10.10.0.0/24` or `10.10.1.0/24`. Never query `10.10.1.21` — that's real production.

## Scope

Detection and triage only — declare, scope, own, escalate. RCA, code fixes, and PRs are a
later shift's job and are explicitly out of scope here; do not attempt them.
