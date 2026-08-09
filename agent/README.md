# SREonCall Agent — AI-native incident response

An SRE agent that watches the OpenTelemetry Demo app on its own, decides what's worth
investigating, builds an evidence-cited root cause from live telemetry, and proposes fixes.

**The LLM's reasoning is the mechanism, not a feature.** There is no alert rule anywhere in
this codebase. The only non-LLM logic is a z-score that measures how far a metric has drifted
from its own trailing baseline — it makes no decision, it just puts numbers in front of the
model. Delete the LLM calls and nothing remains: no detection, no root cause, no severity, no
incident, no resolution, no fix.

## Run it

```bash
cd agent && npm install
node bin/watch.js                       # the agent — runs unattended, no human trigger
node bin/show.js                        # list incidents (headlines)
node bin/show.js INC-0001               # full evidence + reasoning timeline
node bin/ask.js "why product-catalog and not frontend?" INC-0001   # live follow-up
```

Requires `OPENAI_API_KEY` and the `MANAGED_*` LGTM values in the repo-root `.env`.

## How a tick works

```
every 25s
  ├─ pull error rate / p99 latency / CPU / memory for every discovered service
  ├─ z-score each against its own trailing 30 min          ← arithmetic only, no decisions
  ├─ compute per-metric fleet share (is this shared or isolated?)
  └─ ask the LLM: "anything here genuinely worth investigating?"
        └─ for each service it flags:
             ├─ LLM selects investigation playbook(s)      ← its choice, recorded with reasoning
             ├─ LLM runs its own queries: metrics, logs, error traces, span trees
             └─ LLM commits to exactly one terminal action:
                  open_incident │ update_incident │ resolve_incident │ no_incident
```

## Design decisions worth knowing

**Origin vs. victim.** Incidents record the service where the fault *starts*, plus a blast
radius. Investigations that begin at `frontend`, `checkout`, or `recommendation` routinely trace
back to `product-catalog` — naming the loudest symptom would be wrong.

**One incident per fault.** Every investigation sees all open incidents. If it traces back to a
service that already has one, it revises that incident (adding to the blast radius) rather than
opening a duplicate. The revision history is never overwritten — `show.js` renders the full
trail of how the agent's read changed as evidence arrived.

**Evidence is literal.** Each claim carries the exact query and the exact value or log line it
returned, so any of it can be re-run by hand.

**Playbooks are guidance, not branches** (`src/playbooks.js`). Keyed to generic fault classes
(error spike, latency regression, resource exhaustion, dependency failure, cache degradation,
queue backlog, recovery check) — deliberately *not* to the demo's fault-injection flag names,
since the judged flags aren't revealed until code freeze. The LLM picks which apply and may
re-pick mid-investigation.

**It never blinds itself.** Self-correction applies to conclusions about the target system.
The agent has no tool to mute an alert, disable a collector, or reroute its own telemetry —
every LGTM call is read-only.

## Things the live runs taught us

- `payment` is Node.js and emits **no** `http_server_*` or `rpc_server_*` metrics. Only
  `traces_span_metrics_*` (from the collector's spanmetrics connector) covers every service
  regardless of language, so it's tried first. Before this, payment faults were invisible.
- CPU/memory must key on `container_name`, not `service_name`.
- `flagd`'s `EventStream` spans stay open for the process lifetime, so they sit at ~15s and
  dominate p99. Excluded from the latency signal (`STREAMING_SPAN_EXCLUSION`) or every service
  looks like it has a latency incident.
- Raw OTLP traces are ~100k characters — far past the per-request token limit. `summarizeTrace`
  reduces one to the ~1.5k that carries signal, including the application's own error message.
- Host-wide drift (every service's CPU rising together) is not per-service incidents. The fleet
  share is computed in code and handed to the model, because a small model reading 14 lines of
  digest text does not reliably notice the pattern itself.

## Layout

| File | Role |
|---|---|
| `src/lgtm.js` | Live queries to Mimir/Loki/Tempo + trace summarization |
| `src/baseline.js` | z-scores vs trailing baseline (no decisions) |
| `src/triage.js` | Per-tick digest + fleet share → LLM picks what to investigate |
| `src/investigate.js` | Multi-turn tool-use RCA loop → one terminal action |
| `src/playbooks.js` | Investigation playbooks the LLM selects between |
| `src/tools.js` | Tool schemas + dispatch; compacts every result for the token budget |
| `src/store.js` | Append-only incident records |
| `src/github.js` | Draft-PR proposer (drafts only, never merges) |
| `bin/watch.js` `bin/show.js` `bin/ask.js` | Live feed, drill-down, live Q&A |
