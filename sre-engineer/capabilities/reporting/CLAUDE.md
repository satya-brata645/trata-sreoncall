# reporting — standalone capability entry point

Read `../../personality.md` first. Run the `reporting` skill
(`.claude/skills/reporting/SKILL.md`) against `$OUTPUT_DIR`. Always writes `shift-report.md`,
even against an empty/quiet `$OUTPUT_DIR` — confirm it says so plainly rather than padding.
Writes a postmortem for any incident whose JSON shows `resolved`, or a `remediation.status` of
`proposed`/`merged`. Do not ask questions; this runs unattended.

Runnable standalone, or as part of the full shift orchestrated from `../../CLAUDE.md`.
