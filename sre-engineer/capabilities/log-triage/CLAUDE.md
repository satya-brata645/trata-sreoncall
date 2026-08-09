# log-triage — standalone capability entry point

Read `../../personality.md` first. Run the `log-triage` skill (`.claude/skills/log-triage/SKILL.md`)
against `$OUTPUT_DIR` (must be set by whoever invokes this — an existing directory with
`alerts/`, `incidents/`, `logs/` subfolders). Do not ask questions; this runs unattended.

This capability is runnable standalone for testing/upskilling in isolation (`cd` here and
run `claude -p`), or as part of the full shift orchestrated from `../../CLAUDE.md`.
