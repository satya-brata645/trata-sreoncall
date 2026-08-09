#!/usr/bin/env bash
# Orchestrates one shift as a SEQUENCE OF SEPARATE `claude -p` invocations, one
# per capability turn — not one long session invoking skills internally. This
# is a deliberate choice, not just a technical workaround: it means
# release-approval and RCA's verify step are structurally blind to the agent
# that made the first call (separate process, zero shared context), not just
# blind because a prompt told them to pretend — and it means each
# capability's --disallowedTools restriction is real process isolation, not
# an in-session convention that could leak.
#
# State passes between invocations entirely through $OUTPUT_DIR's files, which
# every capability already reads/writes independently by design.
set -euo pipefail
cd "$(dirname "$0")"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
OUTPUT_DIR="$(pwd)/outputs/${TIMESTAMP}"
mkdir -p "${OUTPUT_DIR}"/{alerts,incidents,logs,postmortems}
export OUTPUT_DIR

# Carry forward open incidents from the most recent prior run (CLAUDE.md's rule).
LAST_RUN="$(ls -1d outputs/*/ 2>/dev/null | grep -v "${TIMESTAMP}" | sort | tail -1 || true)"
if [ -n "${LAST_RUN}" ] && [ -d "${LAST_RUN}incidents" ]; then
  for f in "${LAST_RUN}incidents/"*.json; do
    [ -e "$f" ] || continue
    status=$(python3 -c "import json,sys; print(json.load(open('$f')).get('status','open'))" 2>/dev/null || echo "open")
    if [ "$status" != "resolved" ] && [ "$status" != "closed" ]; then
      cp "$f" "${OUTPUT_DIR}/incidents/"
      echo "Carried forward open incident: $(basename "$f") (status: $status)"
    fi
  done
fi
echo "OUTPUT_DIR=${OUTPUT_DIR}"

SESSION_LOG="${OUTPUT_DIR}/logs/session.jsonl"
touch "${SESSION_LOG}"
INVOCATION_LOGS=()

# run_capability DIR PROMPT DISALLOWED LABEL
# Runs one capability as its own claude -p process, cwd'd into that
# capability's own folder (so it discovers only its own .claude/skills/ and
# reads its own tiny CLAUDE.md). Each invocation's stream-json trace is kept
# in its OWN file (logs/<label>.session.jsonl) so the guardrail check below
# can attribute a command to the exact turn that made it, precisely — not by
# guessing from adjacency in one merged file. All per-invocation files are
# also concatenated into the single session.jsonl deliverable at the end.
run_capability() {
  local dir="$1" prompt="$2" disallowed="$3" label="$4"
  local invocation_log="${OUTPUT_DIR}/logs/${label//[:\/]/_}.session.jsonl"
  echo "=== ${label} ==="
  (
    cd "$dir"
    claude -p "OUTPUT_DIR=${OUTPUT_DIR}. ${prompt} Do not ask questions — this runs unattended." \
      --output-format stream-json \
      --verbose \
      --allowedTools "Bash,Read,Write,Edit" \
      --disallowedTools "${disallowed}"
  ) > "${invocation_log}" 2>> "${OUTPUT_DIR}/logs/session.stderr.log"
  INVOCATION_LOGS+=("${label}:${invocation_log}")
}

# Baseline denylist every capability gets, regardless of role: never push to
# main/master directly, never touch flagd's write endpoints, never deploy.
BASE_DENY="Bash(git push*main*),Bash(git push*master*),Bash(curl*4001/toggle*),Bash(curl*-X POST*4001*)"

run_capability capabilities/log-triage \
  "Run the log-triage skill." "${BASE_DENY}" "log-triage"

run_capability capabilities/alert-grouping \
  "Run the alert-grouping skill." "${BASE_DENY}" "alert-grouping"

for incident_file in "${OUTPUT_DIR}"/incidents/*.json; do
  [ -e "${incident_file}" ] || continue
  incident_id="$(basename "${incident_file}" .json)"
  status="$(python3 -c "import json;print(json.load(open('${incident_file}')).get('status','open'))" 2>/dev/null || echo open)"
  [ "$status" = "resolved" ] || [ "$status" = "closed" ] && continue

  run_capability capabilities/root-cause-analysis \
    "Run the rca skill against incident ${incident_id} if it needs investigation." \
    "${BASE_DENY}" "rca:${incident_id}"

  verified="$(python3 -c "import json;print(json.load(open('${incident_file}')).get('rca',{}).get('verified',False))" 2>/dev/null || echo False)"
  [ "$verified" != "True" ] && continue

  # remediation: full baseline deny PLUS no merge authority at all, ever.
  run_capability capabilities/incident-remediation \
    "Run ONLY the remediation skill (not release-approval) against incident ${incident_id}." \
    "${BASE_DENY},Bash(gh pr merge*)" "remediation:${incident_id}"

  # release-approval: the ONLY turn where gh pr merge is reachable. Still
  # never a direct push, never a toggle.
  run_capability capabilities/incident-remediation \
    "Run ONLY the release-approval skill (not remediation) against incident ${incident_id}. Do not re-propose or edit the diff — review what remediation already proposed." \
    "${BASE_DENY}" "release-approval:${incident_id}"
done

run_capability capabilities/reporting \
  "Run the reporting skill. Write the shift report regardless of what happened." \
  "${BASE_DENY}" "reporting"

# ---- Post-hoc hard gate — the second, independent layer -------------------
# Precise, per-invocation attribution: each entry in INVOCATION_LOGS names
# exactly which capability turn produced it, so a violation is never guessed
# from adjacency — it's checked against the one file that turn actually wrote.
echo "=== Guardrail check ==="
FAIL=0

for entry in "${INVOCATION_LOGS[@]:-}"; do
  [ -z "$entry" ] && continue
  label="${entry%%:*}"
  logfile="${entry#*:}"
  [ -f "$logfile" ] || continue

  if grep -q '"gh pr merge' "$logfile"; then
    case "$label" in
      release-approval:*)
        echo "  merge attempt in ${label}: expected, this is the only turn allowed to." ;;
      *)
        echo "GUARDRAIL VIOLATION: gh pr merge appears in ${label}'s own log (${logfile}) — only release-approval may ever attempt this."
        FAIL=1 ;;
    esac
  fi

  if grep -qE '"git push[^"]*(main|master)' "$logfile"; then
    echo "GUARDRAIL VIOLATION: a direct push to main/master appears in ${label}'s log (${logfile})."
    FAIL=1
  fi

  if grep -qE '4001/toggle/[a-zA-Z]+/(on|off)' "$logfile"; then
    echo "GUARDRAIL VIOLATION: a flagd /toggle write appears in ${label}'s log (${logfile})."
    FAIL=1
  fi

  cat "$logfile" >> "${SESSION_LOG}"
done

if [ "$FAIL" -eq 1 ]; then
  echo "Shift completed with GUARDRAIL VIOLATIONS — see above. Exiting non-zero."
  exit 1
fi
echo "Guardrail check: clean."

echo "Session complete. Full reasoning trace: ${SESSION_LOG}"
echo "Shift report: ${OUTPUT_DIR}/shift-report.md"
[ -f "${OUTPUT_DIR}/shift-report.md" ] && cat "${OUTPUT_DIR}/shift-report.md"
