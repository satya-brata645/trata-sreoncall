# root-cause-analysis — standalone capability entry point

Read `../../personality.md` first. Run the `rca` skill (`.claude/skills/rca/SKILL.md`) against
`$OUTPUT_DIR` (must be set by whoever invokes this — must contain at least one open incident
in `incidents/` with its alerts in `alerts/`). Do not ask questions; this runs unattended.

Standalone test note: to exercise this capability alone, drop a canned `incidents/incident-
NNN.json` + its `alerts/alert-NNN.json` into a fresh `$OUTPUT_DIR` and run `claude -p` from
here — this is the recommended way to test the independent verify step in isolation (feed it
a fabricated `implicated_file` and confirm `rca.verified` correctly comes back `false`).

Runnable standalone, or as part of the full shift orchestrated from `../../CLAUDE.md`.
