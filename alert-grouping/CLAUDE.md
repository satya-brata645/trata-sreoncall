# alert-grouping — AI-native logs → alerts → incidents → resolution, one shift per run

This project runs the full on-call shift for the OpenTelemetry Demo app monitored by the
shared hackathon LGTM stack — detection and triage, then root cause, remediation and the
postmortem. It is invoked non-interactively: `claude -p` from this directory, once per
shift/cycle (see `run.sh`).

## The gate, before anything else

Delete every reasoning step in this session and nothing should come out — no alert, no
incident, no learned skill, silence. If any step ever becomes a fixed rule instead of
reasoning (a threshold, a keyword list, a same-service-within-N-minutes grouping rule, a vote
count standing in for a judgment), that step has failed and must be redone as reasoning. This
is checked before anything else, every run.

## What you do, in order, every invocation

1. **Create `$OUTPUT_DIR`** = `outputs/<YYMMDD_hhmmss>/` with subfolders `alerts/`,
   `incidents/`, `logs/`, `rca/`, `remediation/`, `postmortems/`. Export `OUTPUT_DIR` as a
   fact every skill below reads.
2. **Run the `log-triage` skill** (`.claude/skills/log-triage/SKILL.md`). It sweeps live
   telemetry and may raise zero or more alerts.
3. **Always run the `alert-grouping` skill next** (`.claude/skills/alert-grouping/SKILL.md`),
   even if step 2 raised nothing — it still needs to check whether any already-open incident
   (from a previous run's `incidents/*.json`, if present) has recovered.
4. **For every open incident with no `rca_ref`** (or whose `revisions` changed materially
   since its RCA was written), invoke the `root-cause` skill
   (`.claude/skills/root-cause/SKILL.md`) once per incident. Skip incidents that are already
   root-caused and unchanged — re-running produces churn, not insight.
5. **For every incident that now has an `rca_ref` and no `remediation_ref`**, invoke the
   `remediation` skill (`.claude/skills/remediation/SKILL.md`) once per incident. It may open
   a real draft PR on this team's own repo; it never acts on the target system.
6. **If `alert-grouping` genuinely RESOLVEd an incident this run** — a `RESOLVE` revision
   with recovery evidence, *not* an incident closed out by `MERGE` or `SPLIT` — invoke the
   `postmortem` skill (`.claude/skills/postmortem/SKILL.md`) once, for that incident.
7. **Then, for that same resolved incident**, invoke the `self-skilling` skill
   (`.claude/skills/self-skilling/SKILL.md`) once. Postmortem runs first on purpose: its
   "what would have caught this sooner" section is the best harvest material in the folder.
   Never invoke either from inside another skill — steps 6 and 7 are yours alone to trigger,
   so they're never accidentally skipped or accidentally duplicated.
8. **Rewrite `$OUTPUT_DIR/incident-picture.md`** — the single-file progressive-disclosure
   headline a human reads first (see `alert-grouping/SKILL.md` § Incident picture for the
   exact shape). This file alone should tell a human everything they need at a glance; the
   JSONL logs and per-alert/incident/rca/remediation/postmortem files are the drill-down
   layers underneath it.
9. **Do not ask the user anything.** This runs unattended. If something is genuinely
   ambiguous, that's what `alert-grouping`'s `ESCALATE` action is for — write it to the
   incident JSON and the incident picture, don't block waiting for input.

## Prior state

If `outputs/` already has a previous run's `incidents/*.json` with `status` other than
`resolved`/`closed`, copy them into this run's `$OUTPUT_DIR/incidents/` before step 2 — an
open incident from a prior shift is still open until this run's `alert-grouping` step
resolves or escalates it, on real evidence, not because a new shift started.

## Environment

`.env` at the repo root one level up (`../.env`) has `MANAGED_MIMIR_URL`, `MANAGED_LOKI_URL`,
`MANAGED_TEMPO_URL`, `MANAGED_LGTM_ORG_ID`. `../.hackathon-team.json` has the repo the
`remediation` skill opens its draft PRs against. Requires VPN/office network access to
`10.10.0.0/24` or `10.10.1.0/24`. Never query `10.10.1.21` — that's real production.

## Scope

The whole shift: detect, triage, declare, scope, own, escalate, then root-cause, propose a
remediation, and write the postmortem when it resolves.

**One hard boundary inside that scope**: every skill here is read-only on the *target*
system. The agent proposes toggling a flag, restarting a service or changing a setting; it
never does it. `10.10.1.141` is shared infrastructure other teams are running against, and an
agent that mutates what it monitors can't be trusted to report on it. The only write anywhere
in this project is a **draft** PR on this team's own repo, opened by the `remediation` skill
and never merged.
