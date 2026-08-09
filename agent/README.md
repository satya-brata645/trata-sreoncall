# SREonCall Agent — the detect-and-triage shift, covered by software

Implementation of `../PROMPT-signal-to-incident.md`. An AI-native, Service-as-Software
detect-and-triage agent for the OpenTelemetry Demo app: it watches live telemetry unattended,
judges what's abnormal itself (no thresholds, no alert rules, no keyword lists anywhere in
code), raises evidenced alerts, decides what constitutes an incident, and learns from what it
handles. RCA, remediation, and PRs are out of scope by design (see the plan's §1) — this is
the detection/triage shift only.

## Run it

```bash
npm start          # runs forever, self-paced by the attention hook (Ctrl+C to stop)
node run.js --once # runs exactly one cycle, for testing
npm run smoke       # quick connectivity check against the LGTM stack (src/lgtm.js)
```

Requires `.env` at the repo root (one level up) with `MANAGED_MIMIR_URL`, `MANAGED_LOKI_URL`,
`MANAGED_TEMPO_URL`, `MANAGED_LGTM_ORG_ID`, and `OPENAI_API_KEY` — see `../.env`. Needs VPN /
office network access to `10.10.0.0/24` or `10.10.1.0/24`.

## Architecture (maps to plan §3)

```
run.js
 ├─ hooks/attention.js    cheap model glance → worth a look? + self-paced next_check_in_seconds
 ├─ hooks/world-change.js flagd /list poller → diffs flag flips between cycles
 ├─ hooks/lifecycle.js    event bus: incident.declared/.revised/.resolved/.escalated
 ├─ hooks/human.js        inbox for human interjections → agents/human-response.js
 ├─ sensor.js             raw fetch only, zero judgment
 ├─ agents/triage.js      strong model + tools → raises evidenced alerts
 ├─ agents/correlator.js  strong model + tools → declare/attach/merge/split/resolve/escalate
 ├─ skills/author.js      on incident.resolved: writes/revises a learned skill, or declines
 ├─ self-accountability.js  performance report + retroactive-miss check
 └─ surface/cli.js        progressive disclosure: headline → alerts → evidence → full trace
```

`evidence.js` is the verbatim, content-addressed store every claim traces back to.
`agents/investigative-tools.js` is the read-only query toolset (logs/metrics/traces/flags)
shared by triage, correlator, human-response, and self-accountability — one implementation,
so the LogQL service-name normalization and context-size trimming only has to be right once.

## What's genuinely AI-native here (and how to check it yourself)

- Delete every model call and this produces nothing — no alerts, no incidents, no severity.
  `sensor.js`, `evidence.js`, `state.js`, `hooks/world-change.js` only fetch/store/diff.
- No thresholds, keyword lists, or grouping rules exist in code — grep for `if.*>.*|<.*` or
  a hardcoded severity map and you won't find one making a real decision. Severity,
  correlation, resolution, and escalation are single model calls each time.
- The attention hook's cadence (`next_check_in_seconds`) comes from the model every cycle,
  not a fixed interval — see `hooks/attention.js`.
- `skills/learned/` starts empty in this repo. Anything that appears there came from a real
  `incident.resolved` event citing a real incident id and evidence refs — check
  `learned_from` / `evidence_refs` in the frontmatter of any file there.

## Known live-environment quirks (discovered building this, not guessed)

- **Loki's `service_name` label is prefixed** `opentelemetry-demo/<service>`; Mimir and Tempo
  use the bare name. `lgtm.js`'s `normalizeServiceNameSelectors` rewrites exact-match LogQL
  selectors so both forms work, regardless of which one a caller (including the model) writes.
- **flagd's real API is `:4001`**, not the `:4000` web UI (`TARGET_APP_FLAGD_UI` in `.env`
  points at the broken UI — `env.js` deliberately does not use that var).
- **This is a shared environment.** Other teams toggle the same flags. `run.js --once` was
  validated against both a genuinely quiet window (triage correctly raised zero alerts,
  twice) and a live `paymentUnreachable` outage window with real error traces.
- **Tool-result payloads are trimmed before reaching the model** (`investigative-tools.js`'s
  `slimForModel`) — raw log lines carry large, irrelevant `resources` blobs that were blowing
  multi-turn conversations past a tight shared 30k-TPM rate limit. The full untouched
  response is still recorded in the evidence store either way; only what the model sees in
  its own context is trimmed, and it can always issue a narrower follow-up query itself.

## Testing against a live fault

```bash
curl http://10.10.1.141:4001/list                              # current flag states
curl -X POST http://10.10.1.141:4001/toggle/<flag>/on
curl -X POST http://10.10.1.141:4001/toggle/<flag>/off
```

Give the load generator ~60-90s after toggling to route real organic traffic through the
fault before running a cycle — a synthetic curl request often doesn't exercise the real
gRPC call path (verified: a hand-crafted `/api/checkout` POST returned a 7ms envoy-level 500
that never reached the checkout service at all). See `../PROMPT-signal-to-incident.md` §10
for the full acceptance-test list.

## What's validated so far vs. what needs a longer soak

Validated live against the real stack in this session:
- Query layer + service-name normalization (`lgtm.js`)
- Sensor sweep (`sensor.js`)
- Triage: correctly abstains on clean windows (twice), investigates with tools, applies
  skills, self-disconfirms
- Correlator: DECLARE, RESOLVE (correctly refuses to resolve without real recovery evidence),
  revision logging
- Skills: read/write round-trip mechanism, and a real reflection pass that honestly declined
  to write a redundant skill
- Hooks: attention (self-paced cadence), world-change (flag diffing), lifecycle (event
  wiring) — all exercised via `run.js --once`

Not yet soaked in this session (mechanically wired, not yet exercised against a long-running
live incident): `skills/author.js`'s write path firing from a genuinely novel real incident,
`self-accountability.js`'s retroactive-miss check (needs several cycles of history before
it's eligible to run), `hooks/human.js` end-to-end, and `handoff.js`. Run `npm start` for an
extended period against a live fault to exercise these; none of them require code changes to
do so — they're wired into `run.js` already.
