# alert-grouping — standalone capability entry point

Read `../../personality.md` first. Run the `alert-grouping` skill
(`.claude/skills/alert-grouping/SKILL.md`) against `$OUTPUT_DIR` (must be set by whoever
invokes this — an existing directory with `alerts/`, `incidents/`, `logs/`, and
`incident-picture.md`). Do not ask questions; this runs unattended.

This capability is runnable standalone for testing/upskilling in isolation, or as part of the
full shift orchestrated from `../../CLAUDE.md`.
