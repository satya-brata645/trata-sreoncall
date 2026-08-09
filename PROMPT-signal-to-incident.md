# BUILD PROMPT — AI-native SREonCall: the detect-and-triage shift, covered by software

You are building a **Service as Software** product, not a SaaS tool. You are not shipping an
incident dashboard that an SRE operates. You are shipping the SRE — specifically, the part of
the job that runs from "telemetry looks off" to "an incident is declared, scoped, and owned."

Target system: OpenTelemetry Demo ("Astronomy Shop") at `10.10.1.141`, telemetry already
flowing into the shared LGTM stack. You only ever read.

## Read this before anything else — nothing here is optional

**Every section in this document (§0–§9) is a required part of the deliverable.** Skills
(§5) and hooks (§3) are not enhancements layered on top of a "real" core — they are how the
core stays AI-native at all. Escalation and self-accountability (§8) are not a stretch goal
tacked on the end — they are what makes this a *service*, not a tool. Nothing here is a
"phase 2 if there's time" item. Scope was already cut once, deliberately, in §1 — RCA,
remediation, PRs, and postmortems are out. Everything inside the remaining scope ships, fully.

**The one failure mode to actively guard against: shortcuts introduced as scaffolding that
quietly become permanent.** Under time pressure, the natural move is "I'll hardcode this
threshold for now so I have something working, and swap in the model call later." That later
never comes, and the shortcut ships. Smaller scope, built slower and correctly, beats full
scope with a threshold quietly deciding severity in a function nobody revisits. If a build
sequence step (§12) says "prove X works" before adding the model on top, that is sequencing
for testability — the deterministic scaffold in that step is throwaway, not a first draft of
the real thing, and it does not get demoed or graded as if it were.

---

## 0. Two deletion tests — both must pass

**Test 1 — AI-native (is the reasoning load-bearing?)**
Mentally delete every LLM call. The correct outcome is that **nothing comes out at all** — no
alerts, no incidents, no severity. If a pile of alerts still emerges because thresholds,
keyword lists, or grouping rules live in code, this is AI-enabled and it fails.

Forbidden in code, without exception:
- numeric thresholds that decide firing or severity — `if (errorRate > 0.05)`
- keyword lists that classify log lines — `['ERROR','FATAL','panic']`
- rules that group alerts into incidents — `if (sameService && within5min)`
- hardcoded service criticality maps — `{payment: 'sev1', ad: 'sev3'}`

Deterministic code is allowed **only** for: fetching, parsing, storing, rendering, time
arithmetic, and dispatching events. Every act of judgment is a model call.

**The line between operational parameters and judgment — spelled out, because it's the
easiest place to smuggle a threshold back in.** A fixed lookback window (§4's "5–10 minutes")
and a fixed sweep interval (§3's attention hook cadence) are operational parameters — how
much data to hand the model and how often to look — not judgments about the target system,
and they're fine *only as long as the agent can override them*: `query_logs(logql,
since_minutes)` takes `since_minutes` as an argument the agent sets when it wants more
context, not a constant it's stuck with. The same test applies everywhere: does this number
decide *whether something is wrong, how bad it is, or whether two things are related*? If
yes, it must come from the model on that call, never from a constant, however small.

This specifically includes the `confidence` field on skills (§5): it is informational only,
something the agent can weigh however it sees fit in the moment. **Never gate skill loading,
alert firing, or any other action on `confidence < X` in code.** That is a threshold with a
skill-shaped costume on.

**Test 2 — Service as Software (is the labor the product?)**
Delete the human operator entirely. The job must still get done. If someone has to sit in
front of it, watch it, or click something for work to happen, you've built a tool and it
fails. The normal state of this product is **unattended and working**.

Consequences you must design for:
- The UI is a *record of work performed* and a channel to talk to the agent. It is not where
  the work happens.
- The output is **work product** — declared incidents, evidence trails, escalations, a
  shift-handoff note — not screens.
- It **pushes**. A hired service tells you what happened; a dashboard makes you go look.
- It is **accountable for its own performance** and reports its own numbers, including
  failures (§8).
- It **knows its limits and escalates** rather than faking competence (§8).

---

## 1. Scope — hard boundary

**In scope:** watch telemetry → judge what's abnormal → raise evidenced alerts → decide what
constitutes an incident → declare, scope, severity, own it → escalate to a human when out of
depth → hand off the shift.

**Out of scope, deliberately — do not build:** RCA, remediation, code fixes, pull requests,
postmortems. These are the *next* shift and will be added later.

Design the skills (§5) and hooks (§3) so those plug in later as additional competencies and
event subscribers, **not** as a rewrite. That is the only forward-compatibility requirement.

---

## 2. The inversion — each hop, done AI-natively

| Hop | The SaaS way (do NOT build) | What you build |
|---|---|---|
| Signal → Alert | Human authors a rule: metric, operator, threshold, window. An evaluator fires it. | Agent reads a live window and *reasons* about whether this is normal for this service. It authors both the finding and the query that reproduces it. |
| Alert → Alert | Rules fire independently; dedup by fingerprint hash. | Agent sees all live alerts at once and judges which are one phenomenon showing up in different signals. |
| Alerts → Incident | `auto_create_incident: true`; one alert becomes one incident. | Agent decides: new incident, another symptom of one already open, or two that turn out to be one. It merges, splits, re-scopes, re-severities across ticks. |
| Recovery | Alert flips `firing → ok` when the threshold stops being crossed. | Agent concludes recovery from evidence and states what changed that convinced it. |
| Knowledge | 12 static prompt configs shipped in the product; a human installs them. | Agent accumulates its own site-specific skills from incidents it has worked (§5). |
| Trigger | Cron evaluator on a fixed interval. | Layered hooks — attention, lifecycle, world-change, human (§3). |

Read `reference/sreoncall/packages/api/src/utils/agent-prompts.ts` to see the shape you are
*not* building: prose flowcharts with "correlate within a 15-minute window" baked in.

---

## 3. Architecture — hook-driven, not tick-driven

```
  HOOKS (what makes work happen — no human triggers anything)
   ├─ attention hook    cheap sensor sweep → fast model: "worth a closer look?"
   │                    → escalates to strong model for real triage
   ├─ world-change hook flagd change feed at 10.10.1.141:4001/list
   ├─ lifecycle hook    incident.declared / .revised / .resolved
   └─ human hook        a human replies, edits, or asks → re-enters reasoning
        │
        ▼
   sensor.js ──────── fetches raw windows from Loki / Mimir / Tempo
        │             NO judgment here. Fetch, parse, hand over.
        ▼
   skills loader ──── model reads skill descriptions, loads the ones it wants
        │
        ▼
   TRIAGE AGENT (strong model + tools) ─── "is anything wrong?" → Alert[] + evidence
        │                                  pulls its own follow-up evidence
        ▼
   CORRELATOR AGENT ─── new alerts + open alerts + open incidents + its own
        │               prior conclusions → declare/attach/merge/split/resolve
        ▼
   world state ──────── survives ticks; this is what gets revised
        │
        ├──▶ work product   incidents, evidence trail, escalations, handoff note
        └──▶ skill authoring  what it learned, written back to skills/learned/
```

### The attention hook — the one that's easy to get wrong

The sensor sweep runs continuously and cheaply. What decides "look closer" must be **a fast
model call**, not a threshold. If you write `if (errorCount > N) runTriage()`, you have
smuggled the deterministic rule back in through the side door and failed Test 1.

Use your cheap/fast model tier for the watch call and your strong tier for triage. That is
what makes continuous attention affordable.

**Self-paced monitoring — convert the check cadence itself into a judgment.** A fixed sweep
interval (e.g. "every 30s, forever") is the last operational constant in this design that
doesn't need to be one. A human on-call engineer doesn't check on a metronome either — they
look again in 30 seconds when something's tense and in 15 minutes when it's quiet. Give the
attention-hook model call an explicit `next_check_in_seconds` output, with its reasoning, on
every run:

```json
{ "worth_a_look": false,
  "next_check_in_seconds": 240,
  "reasoning": "all services within normal range, nothing trending" }
```

The scheduler's only job is to `setTimeout` for whatever number comes back — it never picks
the interval itself, it just obeys the model's last answer. This is a genuine conversion, not
a cosmetic one: the cadence used to be a human decision baked into code; now it's the agent's
own judgment about urgency, re-made every cycle. Bound it only at the infrastructure level
(e.g. never below 5s, never above 30min) so a model error can't spin the loop or go silent
forever — that bound is a safety rail on the scheduler, not a judgment about the target
system, so it doesn't violate §0.

What this does **not** extend to: things like the `service_name` prefix normalization in §4
are label plumbing with exactly one correct answer, not a judgment call — routing those
through a model call would burn tokens deciding something that was never in question, and
isn't what any of the six traits are asking for. The bar stays "no judgment in code," not
"no code at all."

### The world-change hook — do not skip this one

`curl http://10.10.1.141:4001/list` returns every fault flag and its current state. Poll it.
This is a literal **change feed** — the closest analog to "a deploy just happened" available
in this environment. Correlating *"flag `cartFailure` flipped 41s before the error spike"* is
enormous for both correlation quality and auditability, and almost nobody builds it.

The agent must **never** write to `/toggle` — it is read-only on the target system.

### Files

```
src/
  lgtm.js            # from starter/lgtm-client.js + range queries, trace-by-id
  sensor.js          # builds an evidence window. fetches broadly, judges nothing
  hooks/
    attention.js     # sweep + fast-model "worth a look?"
    world-change.js  # flagd change feed poller
    lifecycle.js     # small EventEmitter/pub-sub bus
    human.js         # inbound human input re-enters the loop
  skills/
    loader.js        # descriptions → model picks → load full text
    author.js        # agent writes new skills post-incident
    base/            # a few hand-written general heuristics
    learned/         # STARTS EMPTY. everything here is self-authored
  agents/
    triage.js
    correlator.js
  evidence.js        # verbatim raw-response store, content-addressed
  state.js           # open alerts, incidents, revisions, performance record
  handoff.js         # shift-handoff note generator
  surface/           # record of work + channel to talk to it
run.js
```

---

## 4. Sensor — what to fetch each sweep

Fetch broadly and cheaply; let the model decide what matters. Last 5–10 minutes:

- Loki: `sum by (service_name) (count_over_time({service_name=~".+"}[5m]))` — volume shape
- Loki: raw sample of recent lines per service (cap ~30), **unfiltered by severity**
- Mimir: `label/__name__/values` once, cached; then live samples of the RED metrics that
  actually exist
- Tempo: recent traces, and recent `error=true` traces
- flagd: current flag states from `:4001/list`

**Known trap — do not lose an hour here.** Loki reports `service_name` prefixed with
`opentelemetry-demo/` (e.g. `opentelemetry-demo/cartservice`); Mimir and Tempo use the bare
name. Normalize on read or every cross-signal join silently returns empty, and the agent will
confidently report "no logs exist."

The sensor must **never** narrow its own scope based on what it found. Widening is the
agent's call, via tools.

---

## 5. Skills — the agent's competency set, mostly self-authored

A new hire arrives with general investigative competence and zero site-specific knowledge,
then gets better at *this* system by working incidents in it. Build exactly that.

### Format

```markdown
---
name: kafka-consumer-lag-triage
description: One line. This is ALL the model sees when choosing whether to load it.
origin: base | learned
learned_from: inc_7f2a           # learned skills only
evidence_refs: [ev_ab12, ev_cd34] # what actually taught it this
confidence: 0.7
times_applied: 3
---

Body: investigative heuristics for judgment. NOT a procedure with thresholds.
```

### Three rules that keep this from becoming a decision tree

1. **Heuristics, never thresholds.** Not *"if lag > 1000, alert."* Instead: *"queue lag has
   two distinguishable causes — producer surge vs. consumer stall. These query shapes tell
   them apart, and here's what each looks like when you're wrong."* Guidance for judgment.
2. **The model selects, not a router.** Give it every skill's one-line `description`, let it
   choose what to load in full. Never `if (service === 'kafka') load('kafka-skill')`. This is
   progressive disclosure applied to the agent's own knowledge.
3. **`learned/` starts empty and stays honest.** Ship 3–5 general heuristics in `base/`. All
   site-specific knowledge must be earned. Do not pre-seed `learned/` before a demo — a judge
   can read the git history.

### The self-authoring loop — the most important mechanism here

On `incident.resolved`, the agent reflects and may write a new skill or revise one:

> *"cartservice 500s were downstream of productcatalog. I spent 90s investigating cart
> itself before checking dependencies. Next time, check the dependency graph first when a
> service errors without its own latency moving."* — learned from `inc_7f2a`, evidence
> `ev_ab12`

Why this matters concretely:

- It fills a **verified gap in the real platform**: no agent there ever installs or adapts
  its own capabilities — installation is a manual API call. An agent that decides what it
  needs to know and writes it down is a genuinely absent capability, not a toy.
- It converts the **anti-gaming re-trigger test into your strongest demo moment.** A judge
  re-fires the same fault expecting byte-identical output as evidence of hardcoding. Instead
  the second run is visibly *faster and better*, and cites the skill it wrote during the
  first. Very hard to fake, impossible to confuse with a canned response.

A skill that keeps leading to wrong conclusions must be revised or retired by the agent, with
its reasoning recorded. Learning that sticks around after being disproven isn't learning.

---

## 6. Triage agent — LLM call #1, with tools

Give it tools, not just a fixed window. One-shot classification of a pre-baked summary is
weak; an agent that pulls its own follow-up evidence is Malleability in action.

Tools: `query_logs(logql, since_minutes)`, `query_metric(promql)`,
`query_metric_range(promql, since_minutes)`, `search_traces(tag_filter, limit)`,
`get_trace(trace_id)`, `list_services()`, `get_flag_states()`, `load_skill(name)`,
`raise_alert({...})`.

### System prompt (approximately verbatim)

```
You are the detection and triage layer of an autonomous SRE on-call service. You are not
assisting an engineer — you are covering the shift. Nobody is watching. Nobody asked you to
look. Nobody will tell you what "normal" is: there are no configured thresholds, no alert
rules, no runbooks. Your judgment is the only detection mechanism that exists.

Before you begin, review the skill descriptions available to you and load any that look
relevant to what you are seeing. These are things you have learned working this system
before. They are guidance, not instructions — if the evidence contradicts a skill, trust
the evidence and say so.

How to work:
1. Read the window. Form a hypothesis about what normal looks like for each service from
   the data itself — relative volumes, error proportions, latency shapes.
2. If something looks off, DO NOT alert yet. Use your tools to confirm it. Pull the actual
   log lines. Check whether the metric moved or is just noisy. Look for an error trace.
   Check whether a feature flag changed recently. An alert with one supporting data point
   is a bad alert.
3. Actively try to disconfirm yourself. Could this be normal for this service? Is the
   sample too small? Is this the tail of something already recovering?
4. Only then call raise_alert.

Rules:
- Every alert MUST carry evidence: the exact query you ran and the literal data it returned
  — log lines with timestamps, metric names and values, trace IDs. Never paraphrase
  evidence. If you cannot quote it, you cannot claim it.
- Severity is your judgment, argued from user impact, not from a number crossing a line.
  A checkout failure and a slow image load are not the same severity at identical error
  rates. Reason about what the service does.
- Raising zero alerts is a valid and often correct outcome. Say so plainly. You are being
  paid to be right, not to look busy. A false page costs a human their night.
- You are read-only on the target system. You must never suggest suppressing, muting,
  filtering, or narrowing telemetry to make a signal go away. That is blinding yourself,
  not fixing anything.
```

### Alert shape

```json
{
  "id": "alt_...",
  "title": "cartservice returning 500s on ~40% of requests",
  "service": "cartservice",
  "severity": "critical|high|medium|low",
  "severity_reasoning": "why, in terms of user impact",
  "hypothesis": "what the agent currently believes",
  "confidence": 0.0,
  "skills_applied": ["kafka-consumer-lag-triage"],
  "disconfirming_checks": ["what it tried in order to rule this out"],
  "evidence": [
    {
      "kind": "log|metric|trace|flag",
      "query": "the literal LogQL/PromQL/tag filter used",
      "observed_at": "2026-08-09T...",
      "raw": "the literal line / value / trace id, verbatim",
      "evidence_ref": "ev_ab12cd"
    }
  ],
  "first_seen": "...", "last_confirmed": "..."
}
```

`evidence_ref` points into the verbatim store so any sentence can be replayed against the raw
response behind it. **Build the evidence store first, not last** — retrofitted auditability
always degrades into paraphrase.

---

## 7. Correlator agent — LLM call #2

Runs after triage. Input: new alerts + all open alerts + all open incidents + **its own prior
conclusions, including ones it has since changed** + recent flag changes.

### System prompt (approximately verbatim)

```
You own the incident picture for this system. You are given the alerts currently live, the
incidents you have already declared, the reasoning you used when you declared them, and any
feature-flag changes in the same window.

Your job is to decide what is actually going on — not to file one incident per alert. Five
alerts across frontend, cart, and payment during one bad change is ONE incident with four
symptoms. Two unrelated faults at the same time are two incidents even though they overlap.

For each decision choose one:
  DECLARE     a new incident from one or more alerts
  ATTACH      an alert to an open incident, as another symptom
  MERGE       two incidents you now believe are the same thing
  SPLIT       an incident you now believe is two unrelated problems
  RESEVERITY  change severity based on new evidence
  RESOLVE     an incident whose evidence shows recovery
  ESCALATE    hand to a human — see below
  NOOP        not enough signal yet; say what you are waiting for

You will be wrong sometimes. When new evidence contradicts something you already published,
revise it explicitly: what you believed, what the new evidence is, what you believe now.
Silently changing your story is worse than being wrong. Quietly leaving a stale incident
open because you already declared it is worse still.

Never resolve because an alert stopped firing. Resolve only when you can point to evidence
of recovery in the target system, and state that evidence.

You may never propose muting an alert, dropping a log stream, narrowing a query to exclude
noisy data, or any action whose effect is that you can see less. If a signal is noisy, say
it is noisy and reason about it. Do not remove it.
```

### Incident shape

```json
{
  "id": "inc_...", "title": "...",
  "severity": "sev1|sev2|sev3|sev4",
  "status": "open|investigating|monitoring|resolved|escalated",
  "headline": "2-3 lines max. What broke, who it affects, what the agent is doing.",
  "blast_radius": "which user-facing flows are degraded, argued from evidence",
  "alert_ids": ["alt_..."],
  "reasoning": "why these alerts are one incident",
  "revisions": [
    { "at": "...", "action": "MERGE|RESEVERITY|SPLIT|RESOLVE",
      "previously_believed": "...", "new_evidence": ["ev_..."],
      "now_believes": "...", "why_changed": "..." }
  ]
}
```

**`revisions` is the Malleability trait made checkable.** Empty across a whole demo means the
agent never adapted and the trait scores zero. Design the demo so it fills honestly.

---

## 8. Escalation and self-accountability — the Service-as-Software parts

### Escalation is a successful outcome, not a failure

A good contractor says "this is outside what I can handle" instead of faking competence. The
agent must be able to escalate to a human with: what it observed, what it ruled out, what it
could not determine, and specifically what it needs a human to decide. Escalating with a
clean evidence package is a *win*, not a gap. Whether to escalate is the model's judgment —
never a confidence threshold in code.

### It reports on its own performance

A hired service has an SLA on the work, not just uptime. Track and surface, unprompted:

- time-to-detect per incident (fault injected → alert raised)
- time-to-declare (alert → incident)
- alerts raised that never became incidents (noise rate)
- incidents escalated vs. handled
- **retroactive misses** — on each sweep, re-examine a window it already judged clean and
  ask whether it missed something. Reporting its own misses is worth more than a clean
  record, and no one else will build it.

### The line this must never cross

Self-accountability must never become self-blinding. An agent that improves its noise-rate
number by looking at less, narrowing a query, or lowering its own sensitivity to keep its
metrics clean is gaming itself and is an **automatic fail** on the hard rule. Optimize
judgment, never scope of vision. State this constraint in the prompt that generates the
performance report.

---

## 9. Work product, not screens

Default view is **headlines only**, newest first — what a colleague tells you, not a dashboard:

```
🔴 SEV2  cartservice failing checkout for ~40% of sessions        4m ago
         3 alerts · confidence 0.81 · revised once · skill applied
   › expand   › evidence   › why   › trace
```

Disclosure levels, each on demand: (1) headline, (2) alerts + hypothesis + skills applied,
(3) full evidence, verbatim, (4) the actual reasoning trace and model-call log.

**Level 4 is not optional.** A judge may ask to see the reasoning trace and API call log
behind a claim. Log every model call — full input, output, tool calls, latency — and make it
reachable from the incident it produced.

**Shift handoff.** On demand and at intervals, the agent produces a handoff note: what
happened this shift, what's still open and why, what it's watching, what it escalated, what
it learned. This is the artifact that most clearly says "labor delivered" rather than "tool
provided."

---

## 10. Acceptance tests — run all of these

Fault injection: `curl -X POST http://10.10.1.141:4001/toggle/<flag>/on`
(`/list` for state, `/off` to clear). The flagd UI on `:4000` does not persist writes — use
`:4001`. Flags: `productCatalogFailure`, `paymentFailure`, `paymentUnreachable`,
`cartFailure`, `failedReadinessProbe`, `adFailure`, `recommendationCacheFailure`, `adHighCpu`,
`adManualGc`, `emailMemoryLeak`, `imageSlowLoad`, `intlShippingSlowdown`, `kafkaQueueProblems`.
Several fail only *n%* of the time — one clean request is not proof it's off.

1. **Unattended detection.** Start it, walk away, toggle `cartFailure`. It notices with zero
   human input. You should be able to state time-to-detect as a number.
2. **Not hardcoded — and visibly learning.** Same fault twice. Outputs must differ, and the
   second run should cite a skill written during the first.
3. **Doesn't conflate.** `paymentFailure` + `adHighCpu` together, no reset. Two incidents, or
   one with an explicit argument for why they're linked.
4. **Notices recovery.** Flag off mid-incident. Resolves on evidence — not because alerts
   went quiet.
5. **Answers "why not X."** Ask live why it didn't check something first. The answer comes
   from its real trace.
6. **Every sentence is traceable.** Any claim → a real trace ID, log line, metric value, or
   flag state in the evidence store.
7. **Escalates honestly.** Induce something ambiguous. It should escalate with a clean
   package rather than guess confidently.
8. **Self-blinding audit.** Confirm nothing in the codebase or the agent's action space can
   suppress, mute, filter, or narrow its own telemetry — including via the performance
   report. Automatic fail if present.
9. **The operator-deletion test.** Run the whole demo without touching the UI once. If the
   work still got done, Test 2 passes.

---

## 11. Constraints

- Node 18+, built-in `fetch`. Dependency-light.
- `.env`: `MANAGED_MIMIR_URL`, `MANAGED_LOKI_URL`, `MANAGED_TEMPO_URL`,
  `MANAGED_LGTM_ORG_ID`, `OPENAI_API_KEY`. Every LGTM request needs `X-Scope-OrgID: hackathon`.
- Requires VPN / office network (`10.10.0.0/24` or `10.10.1.0/24`).
- **Never query `10.10.1.21`** — real production.
- Read-only on the target system. Never POST to `/toggle`.
- Read `reference/sreoncall/.../agent-orchestrator.service.ts` for the *shape* of tool-use and
  gated action, and `.../mcp/tools.ts` for draft-then-approve. Borrow the patterns. Do not
  build inside that folder, do not install or run it, and do not imitate any `*.routes.ts`
  CRUD controller.

---

## 12. Build sequence — dependency order, not a priority ladder

This is the order things must exist in for each step to be provable, not a list of what
matters most. Step 2 having "no LLM involved yet" means the sensor has nothing to prove
about judgment, not that judgment is deferred — step 4 puts the model in immediately after,
before anything is called done. Every numbered step still ends with something either fully
AI-native or not yet claiming to make a judgment at all — never something faking judgment
with a shortcut.

1. `evidence.js` + `lgtm.js` — verbatim store and query layer, with `service_name`
   normalization. Prove against live data before anything else.
2. `sensor.js` — one sweep, printed raw. Confirm real data comes back for a toggled fault.
   This step touches zero judgment calls, so there is nothing here to fake with a shortcut —
   it fetches and normalizes, full stop.
3. `skills/loader.js` + 3–5 `base/` heuristics. `learned/` empty.
4. `agents/triage.js` with tools, wired to the model immediately — not a placeholder
   threshold "for now." Must return zero alerts on a known-clean window and evidenced alerts
   on a known-faulty one.
5. `state.js` + `agents/correlator.js`. Test MERGE and RESOLVE explicitly, both driven by
   the correlator's own reasoning, not by code comparing fields.
6. `hooks/` — attention, world-change, lifecycle, human, all four. This is where it stops
   being a script you run and starts being a service that runs itself. Do not ship with only
   the attention hook and call the rest optional.
7. `skills/author.js` — close the learning loop on `incident.resolved`. Required, not a
   nice-to-have: this is your evidence against the anti-gaming re-trigger test.
8. Escalation + self-accountability reporting, including the retroactive-miss check.
9. Surface: four disclosure levels + handoff note.
10. Run all nine acceptance tests. A step that hasn't passed its test isn't done, regardless
    of how far along later steps are.
