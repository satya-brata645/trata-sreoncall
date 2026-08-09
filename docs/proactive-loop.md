# The proactive loop

The app speaks first. That is the whole product claim, and also the easiest thing in
software to get wrong: a background process with a model attached will happily produce a
paragraph about a nightly dependency scan.

So the path from "an SRE agent noticed something" to "a message appears in an idle tab"
is three gates, and all three have to open.

| Gate | Where | Nature | Failure it prevents |
|---|---|---|---|
| 1. Salience | `lib/agent/salience.ts` | arithmetic | interrupting for noise |
| 2. The brain | `lib/agent/heartbeat-brain.ts` + `lib/agent/proactive.ts` | one model call | saying the obvious thing badly |
| 3. The cursor | `lib/store/events.ts` | state | saying it again, forever |

Gate 1 is explainable and cheap. Gate 2 is smart and can be wrong. Gate 3 is neither —
it is what stops the other two from being asked twice.

## The contract

`lib/agent/events.ts` is the interface between the two agents. Trata's agent is the
manager, not the engineer: it does not query Mimir, tail a log stream or search traces.
A separate SRE agent does that and posts what it found.

**This is the one thing in the path that cannot be changed cheaply once the SRE
agent writes against it.** Everything downstream — the weights, the brain, the memory
tiers, the UI — can be rewritten. This shape is load-bearing.

### What a producer sends — `SreEventInput`

| Field | Type | Req | Meaning |
|---|---|---|---|
| `source` | `string` | yes | Which agent or system is speaking. Non-empty after trim. |
| `kind` | `EventKind` | yes | Closed set, below. |
| `severity` | `EventSeverity` | yes | Closed set, below. |
| `headline` | `string` | yes | One line. What the brain reads first and often all it needs. |
| `summary` | `string` | no | Trimmed if present, `undefined` otherwise. |
| `actionItems` | `string[]` | no | Blank and non-string entries dropped. Defaults to `[]`. |
| `evidence` | `EventEvidence[]` | no | Entries without a non-empty `ref` dropped. Defaults to `[]`. |
| `sessionId` | `string` | no | The producer's run. Carried onto the message. |
| `incidentId` | `string` | no | The grouping key everything downstream joins on. |
| `confidence` | `number` | no | 0–1 inclusive; anything outside becomes `undefined`. |
| `externalId` | `string` | no | The producer's own id. Used for dedupe. |
| `at` | ISO 8601 | no | Causal time. Unparseable or absent → now. |

`EventEvidence`: `kind` (`"metric" | "log" | "trace" | "pr" | "dashboard" | "runbook" |
"other"`, so the UI can badge it), `ref` (required — the identifier a person would paste
somewhere to see it themselves), optional `label`.

### What the server stamps — `SreEvent`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Derived, not random. See below. |
| `at` | ISO 8601 | Normalised through `toISOString()`. Always present. |
| `receivedAt` | ISO 8601 | Arrival time. This, not `at`, is what the cursor moves along. |
| `actionItems` | `string[]` | Always an array. |
| `evidence` | `EventEvidence[]` | Always an array. |

### The enums, exactly

```ts
type EventSeverity = "critical" | "high" | "medium" | "low" | "info";
type EventKind = "detection" | "incident" | "diagnosis" | "remediation" | "resolved" | "report";
```

`resolved` is in the set on purpose. An agent that only ever hears about breakage keeps
reporting a fixed problem — recovery has to be *sayable* for the picture to stay true,
and every tier below has a special case for it.

### Why it is this narrow

An event says what happened, how bad it is, and what a person could point at to check.
It does not carry the telemetry.

**Evidence is references, never payloads.** The value of "cites a real trace id"
is precisely that someone can go and look. A copied-in log line is a claim, not a
citation — it proves only that the producer can type. `ref: "a1f39c02bb7e4d51"` can be
checked against the system that issued it; a pasted stack trace cannot.

**`confidence` is optional and never inferred.** A confidence this side invented
would be a number with no method behind it, rendered next to numbers that have one. An
event without one renders *absent* — see rule 3 under [Brain on real
events](#brain-on-real-events).

## Derived ids and idempotency

`parseEvent` computes the id rather than generating one:

```
with externalId:     evt-<slug(source)>-<slug(externalId)>
without externalId:  evt-<slug(source)>-<slug(headline)>-<at.slice(0,19)>
```

`slug` lowercases, collapses non-alphanumerics to `-`, trims, truncates to 60; the
fallback truncates `at` to whole seconds. So an SRE agent retrying a failed POST writes
the same line twice to the append-only NDJSON log — and the reader collapses it —
without having to mint an id to get that.

**First occurrence wins** (`readEvents`, `lib/store/events.ts`). A retry is the
same event arriving again, not a correction of it, and it carries a fresh `receivedAt`
plus whatever fields the producer happened to resend. Letting the later line overwrite
moved an incident's start time forward and dropped the action items from the original —
a replay rewriting history instead of being ignored. A torn line costs one event, not
the log.

`parseEvent` returns `SreEvent | { error: string }`, and `app/api/events/route.ts` turns
the error branch into a 400 carrying that sentence. The producer is another agent:
``"`kind` must be one of: detection, incident, diagnosis, remediation, resolved,
report."`` is actionable, and an exception is not.

Ingest is authorised by shared secret (`SRE_INGEST_SECRET`, header `x-internal-secret`)
rather than a session, because the caller is a process, not a person. Unset, the route
is open — right for a laptop, wrong everywhere else — so the response carries
`unsecured: true` rather than failing quietly open.

## Gate 1 — salience

`lib/agent/salience.ts`. The bar an event clears before the agent even
*considers* speaking.

| Input | Weight |
|---|---|
| `severity: "critical"` | 4 |
| `severity: "high"` | 3 |
| `severity: "medium"` | 2 |
| `severity: "low"` | 1 |
| `severity: "info"` | 0 |
| `actionItems.length > 0` | +1 |
| `kind === "resolved"` | floor at `MATTERS_WEIGHT` |
| not substantive, no evidence, weight exactly `MATTERS_WEIGHT` | −1 |

`MATTERS_WEIGHT = 3` and `matters = weight >= MATTERS_WEIGHT`, so `high` and worse clear
on severity alone and everything else has to earn it.

Two promotions, both with a reason. **Action items**: something a person has to
*do* is worth more than something that merely happened — the point of speaking
up is to shorten the gap between knowing and acting. **Recovery**: `Math.max(weight,
MATTERS_WEIGHT)`, because an agent that reports the break and not the fix leaves the
user believing something is still on fire, a worse failure than saying one thing too
many.

One demotion — a claim nobody can check is not worth interrupting for:

```ts
const substantive = event.actionItems.length > 0 || event.kind === "resolved";
if (!substantive && event.evidence.length === 0 && weight === MATTERS_WEIGHT) weight -= 1;
```

The `substantive` guard is a bug fix wearing a variable name. Without it the tiebreak
landed on exactly the events the two promotions had just lifted to `MATTERS_WEIGHT` — an
uncited recovery, or an uncited `medium` with a next action, promoted and then
immediately demoted back below the bar. `lib/agent/__tests__/salience.test.ts` caught
it.

**Why arithmetic and not a model call.** A model asked "does this matter" on
every event is a model asked to be consistent about a threshold, the thing models are
worst at. And — the important one — *"why did you tell me this?"* needs an answer: a
weight and a cut-off can be shown, argued with and corrected, while a judgement that
came out of a paragraph of reasoning can only be re-rolled. Hence
`SalienceScore.because` is prose in the user's words, `"critical severity, has action
items"`, not a log string. It gets shown.

`score`/`split` are the standing, memory-free bar, used on the ingest hot path so a POST
never touches disk. The heartbeat uses `scoreInContext`/`splitInContext`: same base plus
novelty (`1` never seen, `0.5` not seen in seven days, else `0`), habituation (`min(0.6,
repeatsInLastHour × 0.15)`, subtracted) and `+1` for touching an open incident. Same
cut-off, same `because`, still no model call.

## Memory

`lib/agent/memory/traces.ts` (pure) and `lib/agent/memory/index.ts` (protocols),
persisted by `lib/store/memory.ts`. `traces.ts` has **no I/O and no ambient clock** —
every function takes `now`. The heartbeat owns when a trace is touched; these functions
only make the resulting ranking reproducible.

| Tier | Holds | Half-life | Cap |
|---|---|---|---|
| `stm` | working set: live incidents and hypotheses | 45 min | `STM_CAP = 7` |
| `mtm` | episodes, one per resolved incident | 3 days | `MTM_CAP = 200` |
| `ltm` | abstracted facts and procedures | 90 days | — |

`HALF_LIFE_MS` is exported; `REINFORCEMENT_ALPHA` is not, and is `stm 0.4`, `mtm 0.25`,
`ltm 0.15`. (`memoryView` and `runMemoryProtocols` currently slice episodes with a
literal `200` rather than `MTM_CAP`.)

`signatureForEvent` = `` `${source}:${kind}:${severity}:${slug(headline)}` `` — the join
key for "have we seen this before", deliberately coarse.

`decayTrace(trace, now)` multiplies `strength` and `activity` by `2 ** (-elapsed /
HALF_LIFE_MS[tier])`, measured from `lastHitAt` rather than creation, so something
repeatedly touched stays warm.

`reinforceTrace(trace, salience, now)` is **saturating, preserving the `0..1` invariant
without a clamp**: `boost = ALPHA[tier] * clamp(salience, 0, 1)`, then `strength = 1 -
(1 - strength) * (1 - boost)`. It closes a fraction of the remaining gap, so 0.95
reinforced hard goes above 0.95 and still below 1 — a clamp would hide how close to the
ceiling the trace already was. `hits` increments; `lastHitAt` moves to `now`.
`confidenceFor` is Laplace, `(confirmations + 1) / (confirmations + contradictions +
2)`, so nothing observed reads 0.5 rather than 1.0. `rankTraces` sorts by `strength`
descending, ties broken by `lastHitAt` descending. `traceForEvent` seeds STM at
`strength: 0.35`, kind `hypothesis` for a `diagnosis` and `incident` otherwise,
`confirmations: 1` for a `resolved`.

`runMemoryProtocols(events, touched, now)` runs decay → bind/reinforce → consolidate →
evict → publish, each step recording into `protocols` state so a memory failure is
*inspectable* without stopping the heartbeat from deciding whether to speak — which is
why the heartbeat calls it inside `.catch(() => undefined)`.

**Consolidation folds the durable event log, not just the current batch.** This
is the load-bearing choice, and it exists because the cursor advances *before* the model
call (Gate 3). Derived only from the batch in hand, a beat that died after advancing its
cursor would lose that incident from memory permanently. Folding `readEvents()` makes a
failed beat **rebuildable rather than lossy**.

An episode is consolidated only when an `incidentId` group inside the 90-day window
contains a `resolved` event; keyed `episode-<incidentId>` so it is written once, after
which the incident's working traces are dropped. Episodes carry `ttdMs` / `ttmMs` /
`ttrMs` — first event to first diagnosis, first remediation, resolution. Eviction keeps
STM at `STM_CAP`, safe precisely because a trace that loses the ranking has either been
consolidated or is still derivable from the log.

`abstractLongTerm` is the loop's only other model call: at most hourly, only for a
signature with three or more episodes spanning over 24 hours, and rejected unless every
cited `sourceEventIds` entry appears in the episodes actually supplied — a citation
check, not a vibe check. `GET /api/brain/memory` publishes the ranked view plus
`hasLiveData`; `lib/hooks/useBrainMemory.ts` polls it every 15s.

## Gate 2 — the brain

`buildBriefing` (`lib/agent/heartbeat-brain.ts`) writes three sections: `[STANDING
CONTEXT]` (top 7 working traces with strength %), `[RECALLED]` (up to 3 episodes
matching a batch signature) and `[NEW SINCE LAST BEAT]` — written as a person would
brief a colleague coming back from lunch, because that is the judgement being asked for.
Each event carries severity, source, headline, summary, `next:` actions, `evidence:`
refs and `eventRef: <id>`, so the message the brain writes *can* cite one; a claim the
user cannot check is the thing this product is trying not to be. Only `[NEW SINCE LAST
BEAT]` goes through `fenceWithNotice(…, "third-party content")` — the other two sections
are our own derived, receipt-backed state.

Then **one call, no tools**, `claude-sonnet-5`, `max_tokens: 400`, with
`PROACTIVE_SYSTEM` from `lib/agent/proactive.ts`:

> Reply with JSON only: `{"speak": true, "message": "..."}` or
> `{"speak": false, "message": ""}`.

`parseDecision` strips a code fence, takes the outermost `{…}`, and requires `speak ===
true` **and** a non-empty trimmed `message`. Everything else — no API key, non-2xx,
thrown fetch, malformed JSON, `speak` with no message — returns `{ speak: false,
message: "" }`.

**It fails closed.** An unreachable model produces silence, never a fallback
sentence. A background loop that invents something to say when it cannot think is the
exact failure the salience bar exists to prevent.

## Gate 3 — the cursor

`lib/store/events.ts` holds `HeartbeatState`: `lastSeen` (everything at or before this
is settled, spoken about or not) and `announced[]` (ids already put to the brain, so a
silent verdict is not re-asked).

`eventsForBeat` is bounded three ways — `LOOKBACK_DAYS = 2`, the cursor, and a per-beat
`limit` defaulting to 10 — so a backlog produces one sensible message rather than a
burst. It filters on **`receivedAt`, not `at`**: producer clocks can be slow and
backfill old causal times, and filtering on `at` would silently discard those events
forever.

`writeHeartbeatState` trims `announced` to `ANNOUNCED_CAP = 500` and writes through a
**uniquely named** temp file before `rename`. A fixed `state.json.tmp` is the bug MCS
shipped: two writers stage into the same path and the second `rename` finds nothing
there.

> **The invariant: the cursor advances over everything briefed, including the
> events the brain chose to stay quiet about. Silence is a verdict, not a
> deferral.**

Without this the same event comes back every fifteen minutes forever, and an agent that
keeps re-litigating yesterday is worse than one that says nothing.

And it advances **before** the model call:

```ts
await writeHeartbeatState({
  lastSeen: considered.at(-1)?.receivedAt ?? state.lastSeen,
  announced: [...state.announced, ...considered.map((event) => event.id)],
});
```

Writing it afterwards left the batch eligible for the eight seconds the brain was
thinking, so a beat overlapping that window briefed the same events again and paid for a
second opinion on them. The in-process lock does not close this: under `next dev` the
standing loop and the route handlers are separate module instances holding separate
locks. Advancing first is also what the invariant already says out loud — a batch is
spent once it has been *asked about*, whatever the answer turns out to be. Note
`considered`, not `mattering`.

**`withBeatLock`.** The cursor is the one read-modify-write in the proactive
path and the early wake can land on top of the interval, so beats are serialised through
a single promise chain. The log deliberately is *not* locked: append-only NDJSON deduped
on read lets the ingest route and the heartbeat run concurrently holding nothing.
Serialising the cursor is cheaper and clearer than making it a log too.

## Triggers

`lib/agent/heartbeat-runner.ts`. Two triggers, one handler.

**The standing interval.** `DEFAULT_INTERVAL_SECONDS = 900` — fifteen minutes,
matching MCS's cron, overridable with `TRUNK_HEARTBEAT_LOCAL_SECONDS`. The point of a
heartbeat is that it keeps going, not that it is fast. It sleeps first: beating on boot
would fire during a hot reload and race the seed, and there is nothing a beat at `t=0`
can know that one at `t=interval` cannot.

**The early wake.** `POST /api/events` scores each arrival with the standing
`score()` and calls `wakeEarly()` when it clears the bar — anything `high` or worse,
plus anything promoted by an action item or a recovery. A SEV-1 that waits a quarter of
an hour is a capability nobody can demonstrate and nobody would trust.

**The debounce** (`EARLY_WAKE_DEBOUNCE_MS = 2_500`) is the entire reason
`wakeEarly` is not just a call to `runHeartbeat`. A failing deploy produces events in a
burst; ten wakes would be ten briefings and up to ten messages about one thing. Each
call clears the pending timer and re-arms it, so the burst collapses into one beat —
which also gets a *better* briefing than any of the ten would have had, because it sees
the whole burst at once.

`lastBeat()` exposes the last `BeatResult` (`considered`, `mattered`, `spoke`,
`message`, `silentBecause`) to the debug surface and `GET /api/heartbeat`.

**Lifetime.** Started from `instrumentation.ts`, which Next calls once per server
process — the only hook for "start something that outlives a request" — guarded on
`NEXT_RUNTIME === "nodejs"`, because the edge runtime has no timers that survive a
response and importing the store there would fail on `node:fs`. Both routes pin `runtime
= "nodejs"` and `dynamic = "force-dynamic"`. In-process means it lives and dies with the
dev server, the right lifetime for a laptop. A deployment sets `TRUNK_HEARTBEAT_LOCAL=0`
— `startHeartbeat` returns immediately — and points a real scheduler at `POST
/api/heartbeat`, which calls the same `runHeartbeat` and therefore takes the same beat
lock, so a cron firing mid-interval queues rather than races.

## Where the message lands

When the brain says speak, the beat appends to the home conversation
(`HOME_CONVERSATION_ID`) with `id: hb-<fnv1a(batchKey)>`, where `batchKey` is the
mattering event ids joined by `|` — **idempotent by construction**, so a replayed beat
writes a line the conversation reader collapses rather than a second one. Also `role:
"agent"`, `source: "heartbeat"`, `read: false`, `severity` = the worst in the batch (the
edge the message wears), and `eventRef` / `sessionId` from the first mattering event.

Nothing pushes. `components/os/apps/ChatApp.tsx` polls the home thread every
`CONVERSATION_POLL_MS = 15_000` — the trunk is the one conversation something other than
this browser tab writes to — merging by id with local winning on collisions. That union
is what makes the heartbeat's message simply *appear* in an idle tab, with no special
case for it in the UI. MCS chose 15s over a websocket and the trade holds: one small
GET, no connection to keep alive, nothing to reconnect after a laptop lid closes.

## Answering for it afterwards

Speaking first is half the claim; surviving the follow-up is the other half.
`read_events` (`lib/agent/data-tool-client.ts`, declared in `app/api/agent/route.ts`)
reads the log back — newest first, optionally narrowed by `incidentId`, as compact text
rather than JSON because it is read far more often than parsed.

It is **read-only** and **not mode-gated**: `mode === "self"` disables every desktop
verb and `read_events` stays, because looking something up is not desktop control and an
agent that cannot check its own claims while being questioned about them is least useful
exactly when it matters most. It is offered to the reasoning lane only — the light
lane's job is windows, and handing it the incident log would invite it to answer
questions it has no business answering.

Without it the central claim does not survive one follow-up: the app speaks citing an
event id, and then "why did you tell me that?" has nothing behind it, because the log
was something the heartbeat could read and the chat could not.

## Brain on real events

`lib/agent/brain-view.ts` turns the log into the picture Brain draws: `deriveIncident`,
`deriveHypotheses`, `deriveWorkingMemory`, all three **pure** — no fetch, no React, no
clock beyond what is passed in — so the derivation is testable without a browser.
`lib/hooks/useAgentActivity.ts` polls `/api/events` every 15s, reverses the newest-first
feed once so every derivation reasons forward through time, and reports `hasLiveData`.
Fixtures survive only as the empty state, and the caller must be able to tell the
difference: "this is a picture" and "this is what happened" must not look identical.

Three rules, each a bug first.

**1. Severity is the worst it ever was.** `deriveIncident` reduces the group with
`RANK` and labels P1–P5. Taking the latest event's severity meant an incident that
opened at P1 became a P3 because the most recent update happened to be routine.

**2. Confidence tracks the leading diagnosis.** `incidentConfidence` takes
`Math.max` over the `diagnosis` events that reported a number, falling back to the most
recent reported confidence only when nothing has been diagnosed yet — at which point
"confidence" can only mean confidence in the detection itself. Taking the newest number
instead reported the confidence of whichever theory was mentioned last, so **posting a
weak alternative made the incident look less understood than it was**.

**3. A field the events did not carry renders absent.** Everything unsaid comes
back `undefined` and the renderer shows a gap as a gap. No invented confidence — and no
invented incident: events without an `incidentId` are ignored rather than wrapped in a
synthetic one, which would be the fabrication this layer exists to remove.

Supporting choices: only `diagnosis` events become hypotheses (the rest are things that
happened, not things that might be true; folding them in turns a ranked set of beliefs
into a feed); exactly one is `leading`, never two, because a panel showing two leading
theories has not decided anything, the rest `active` at ≥0.5 and `watching` below; a
resolved incident stays on screen, because "it recovered" is the most useful thing the
panel can say in the minutes after it does; stamps are `T+02m` offsets from the first
event, because what matters reading an incident back is how far into it something was
said.

## The demo

`./scripts/demo-incident.sh` (`BASE` defaults to `http://localhost:3000`, honours
`SRE_INGEST_SECRET`) posts a real sequence at `POST /api/events`. Timestamps are
staggered explicitly — without them everything lands in the same second and working
memory reads `T+00m` five times over, which is accurate and useless.

| Step | Posts | Must happen |
|---|---|---|
| 1 | `detection`, `critical`, an action item, a trace ref and a metric ref, T−16m | Clears gate 1 on severity; wakes the loop early |
| 2 | `diagnosis`, `high`, `confidence 0.88` (connection pool), T−11m | Becomes the **leading** hypothesis |
| 2 | `diagnosis`, `medium`, `confidence 0.31` (Kafka lag), T−9m | Ranks below it, and must **not** lower the incident's confidence |
| 3 | `report`, `low`, no action items, no evidence, T−7m | **Silence.** Nothing to do, nothing to check |
| 4 | the step-1 `detection` again, same `externalId`, no `at` | **No second report.** Same derived id, first occurrence wins |
| 5 | `resolved`, `info`, a PR ref, T−2m | Speaks anyway — `info` floored to `MATTERS_WEIGHT` |
| 6 | polls `GET /api/heartbeat` | Reports what the last beat decided, and why |

Step 6 polls rather than sleeps: the early wake debounces ~2.5s and then spends as long
as the model takes, so a fixed wait reported `null` and read as a broken heartbeat when
the beat was simply still thinking.

The point is what the script does *not* produce — its own closing checklist says it
plainly: **one unprompted message in the home thread, not five.** The noise stays
silent, the replay does not double-report, and the recovery is said out loud even though
it arrived at the lowest severity in the enum.
