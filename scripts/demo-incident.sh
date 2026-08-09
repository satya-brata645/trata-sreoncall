#!/usr/bin/env bash
#
# Drive one incident through the whole proactive path, the way the SRE agent
# will once it is wired.
#
# What this is for: the three gates between an event and a message are easy to
# describe and hard to believe without watching them. This posts a real
# sequence, then two things that should *not* produce a message, so the demo
# shows judgement rather than a feed.
#
#   ./scripts/demo-incident.sh              # against localhost:3000
#   BASE=http://host:3000 ./scripts/demo-incident.sh
#
# Watch it land in the Chat window's home thread, and in Brain.

set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
SECRET="${SRE_INGEST_SECRET:-}"
INCIDENT="${INCIDENT:-INC-$(date +%H%M%S)}"

# Explicit, staggered timestamps. Without them every event lands in the same
# second and working memory reads T+00m five times over — which is accurate and
# useless. A real incident arrives spread out; the demo should look like one.
now_minus() { # minutes ago -> ISO 8601 UTC
  if date -u -v-1M >/dev/null 2>&1; then date -u -v-"$1"M +%Y-%m-%dT%H:%M:%SZ   # BSD/macOS
  else date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ; fi                      # GNU
}
T_DETECT=$(now_minus 16); T_DX1=$(now_minus 11); T_DX2=$(now_minus 9)
T_NOISE=$(now_minus 7);   T_RESOLVED=$(now_minus 2)

post() {
  curl -sS -X POST "$BASE/api/events" \
    -H 'content-type: application/json' \
    ${SECRET:+-H "x-internal-secret: $SECRET"} \
    -d "$1"
  echo
}

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "1/6  Detection — the SRE agent notices, unprompted"
post "$(cat <<JSON
{ "source": "sre-engineer", "kind": "detection", "severity": "critical",
  "incidentId": "$INCIDENT", "externalId": "$INCIDENT-detect", "at": "$T_DETECT",
  "headline": "Checkout p99 crossed 4s and the error rate is climbing",
  "summary": "paymentservice began returning 503 on roughly 18% of charge attempts at 14:02.",
  "actionItems": ["Confirm whether the Kafka consumer lag is cause or symptom"],
  "evidence": [
    { "kind": "trace",  "ref": "a1f39c02bb7e4d51", "label": "failing charge span" },
    { "kind": "metric", "ref": "http_server_duration_p99{service=\"checkout\"}" }
  ] }
JSON
)"

step "2/6  Two competing diagnoses — Brain ranks these, one leads"
post "$(cat <<JSON
{ "source": "sre-engineer", "kind": "diagnosis", "severity": "high", "confidence": 0.88,
  "incidentId": "$INCIDENT", "externalId": "$INCIDENT-dx1", "at": "$T_DX1",
  "headline": "paymentservice is exhausting its connection pool under retry amplification",
  "summary": "Pool saturation precedes the first 503 by 40s; retries triple offered load.",
  "evidence": [{ "kind": "metric", "ref": "db_pool_in_use{service=\"payment\"}", "label": "pool at ceiling" }] }
JSON
)"
post "$(cat <<JSON
{ "source": "sre-engineer", "kind": "diagnosis", "severity": "medium", "confidence": 0.31,
  "incidentId": "$INCIDENT", "externalId": "$INCIDENT-dx2", "at": "$T_DX2",
  "headline": "Kafka consumer lag is starving the order pipeline",
  "summary": "Lag is real but trails the first error by two minutes, so it reads as downstream.",
  "evidence": [{ "kind": "log", "ref": "loki:{app=\"orders\"} |= \"lag\"" }] }
JSON
)"

step "3/6  Noise — low severity, no action, nothing to check. Must stay silent."
post '{ "source": "sre-engineer", "kind": "report", "severity": "low",
        "externalId": "nightly-scan", "at": "'"$T_NOISE"'", "headline": "Nightly dependency scan found nothing new" }'

step "4/6  The same detection again — a retrying producer must not double-report"
post "$(cat <<JSON
{ "source": "sre-engineer", "kind": "detection", "severity": "critical",
  "incidentId": "$INCIDENT", "externalId": "$INCIDENT-detect",
  "headline": "Checkout p99 crossed 4s and the error rate is climbing" }
JSON
)"

step "5/6  Recovery — always worth saying, even at info severity"
post "$(cat <<JSON
{ "source": "sre-engineer", "kind": "resolved", "severity": "info",
  "incidentId": "$INCIDENT", "externalId": "$INCIDENT-resolved", "at": "$T_RESOLVED",
  "headline": "Checkout error rate back to baseline after the pool limit was raised",
  "summary": "p99 settled at 380ms. Watching for 30 minutes before closing.",
  "evidence": [{ "kind": "pr", "ref": "#482", "label": "raise payment pool ceiling" }] }
JSON
)"

step "6/6  What the last beat decided, and why"
# Poll rather than sleep. The early wake debounces for ~2.5s and then spends as
# long as the model takes; a fixed wait reported `null` and read as a broken
# heartbeat when the beat was simply still thinking.
for _ in $(seq 1 20); do
  beat=$(curl -sS "$BASE/api/heartbeat")
  [ "$beat" != '{"lastBeat":null}' ] && break
  sleep 1
done
echo "$beat"
echo
echo "Events on file:"
curl -sS "$BASE/api/events" | grep -o '"id":"[^"]*"' | sort -u

cat <<'NEXT'

Now check, in order:
  • Chat → home thread: one unprompted message, not five. Silence on the noise.
  • Brain: the incident header shows the P1, the leading hypothesis is the
    connection pool one, and working memory reads T+00m onward.
  • Ask it "why did you tell me that?" — the answer should cite the event.
  • GET /api/agent/runs — every window it moved, by app name, not handle.
NEXT
