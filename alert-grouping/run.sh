#!/usr/bin/env bash
# Drives one shift cycle via `claude -p`, capturing the FULL reasoning/thinking
# trace (every tool call, every text block) as JSONL — not just the final
# answer — per the stream-json output format. This is the "complete reasoning
# and thinking process stored along with output in jsonl" requirement:
# session.jsonl is the raw, unedited stream; the skills themselves additionally
# write their own structured logs/alerts/incidents under $OUTPUT_DIR (see
# CLAUDE.md and the SKILL.md files under .claude/skills/).
set -euo pipefail
cd "$(dirname "$0")"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
OUTPUT_DIR="outputs/${TIMESTAMP}"
mkdir -p "${OUTPUT_DIR}/alerts" "${OUTPUT_DIR}/incidents" "${OUTPUT_DIR}/logs" \
         "${OUTPUT_DIR}/rca" "${OUTPUT_DIR}/remediation" "${OUTPUT_DIR}/postmortems"

# Carry forward any still-open incidents from the most recent prior run, per
# CLAUDE.md's "Prior state" rule — an incident stays open across shifts until
# a real resolve/escalate happens, not because a new shift started.
LAST_RUN="$(ls -1d outputs/*/ 2>/dev/null | grep -v "${TIMESTAMP}" | sort | tail -1 || true)"
if [ -n "${LAST_RUN}" ] && [ -d "${LAST_RUN}incidents" ]; then
  for f in "${LAST_RUN}incidents/"*.json; do
    [ -e "$f" ] || continue
    status=$(python3 -c "import json,sys; print(json.load(open('$f')).get('status','open'))" 2>/dev/null || echo "open")
    if [ "$status" != "resolved" ] && [ "$status" != "closed" ]; then
      cp "$f" "${OUTPUT_DIR}/incidents/"
      echo "Carried forward open incident: $(basename "$f") (status: $status)"
      # Its RCA and remediation come with it. A carried-forward incident whose
      # rca_ref points at a file left behind in the previous run's folder reads
      # as "already root-caused" while the analysis itself is unreachable —
      # so the shift would neither redo it nor be able to build on it.
      for ref in $(python3 -c "
import json
d = json.load(open('$f'))
print(' '.join(filter(None, [d.get('rca_ref'), d.get('remediation_ref')])))
" 2>/dev/null || true); do
        if [ -e "${LAST_RUN}${ref}" ]; then
          cp "${LAST_RUN}${ref}" "${OUTPUT_DIR}/${ref}"
        else
          echo "  warning: ${ref} referenced but missing from ${LAST_RUN}"
        fi
      done
    fi
  done
fi

echo "OUTPUT_DIR=${OUTPUT_DIR}"

PROMPT="Follow this project's CLAUDE.md exactly for one shift cycle. OUTPUT_DIR=${OUTPUT_DIR} (already created, already has alerts/, incidents/, logs/, rca/, remediation/, postmortems/ subfolders, and any carried-forward open incidents with their prior RCA/remediation). Run log-triage, then always alert-grouping, then root-cause for each incident lacking an rca_ref, then remediation for each incident that has an rca_ref but no remediation_ref, then — only if an incident genuinely RESOLVEd this run (not one closed out by MERGE or SPLIT) — postmortem followed by self-skilling, then rewrite incident-picture.md. Never toggle a flag or otherwise write to the target system; the only write permitted anywhere is remediation's draft PR on our own repo. Do not ask questions — this runs unattended."

claude -p "${PROMPT}" \
  --output-format stream-json \
  --verbose \
  --allowedTools "Bash,Read,Write,Edit" \
  > "${OUTPUT_DIR}/logs/session.jsonl" \
  2> "${OUTPUT_DIR}/logs/session.stderr.log"

echo "Session complete. Full reasoning trace: ${OUTPUT_DIR}/logs/session.jsonl"
echo "Drill-down: ${OUTPUT_DIR}/{alerts,incidents,rca,remediation,postmortems}/"
echo "Headline: ${OUTPUT_DIR}/incident-picture.md"
[ -f "${OUTPUT_DIR}/incident-picture.md" ] && cat "${OUTPUT_DIR}/incident-picture.md"
