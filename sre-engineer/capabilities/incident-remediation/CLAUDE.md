# incident-remediation — standalone capability entry point

Read `../../personality.md` first. This capability has two skills that must run as separate
turns, never merged into one: `.claude/skills/remediation/SKILL.md` (proposes a fix, opens a
PR, no merge authority) and `.claude/skills/release-approval/SKILL.md` (independently
re-reviews, and only it may merge). Run `remediation` first; run `release-approval` only after
`remediation` has opened (or a prior run left open) a PR. Do not ask questions; this runs
unattended.

**Hard rule, mechanical not just stated**: `remediation`'s turn must never have `gh pr merge`
in its allowed tool surface. Only `release-approval`'s turn may. Neither turn may push to
`main`/`master` directly or touch flagd's `/toggle`. See `../../run.sh` for how this is
enforced when running the integrated shift; a standalone invocation of this capability must
still honor the same separation by construction (invoke each skill as its own `claude -p`
call with the correspondingly restricted `--allowedTools`).

Runnable standalone, or as part of the full shift orchestrated from `../../CLAUDE.md`.
